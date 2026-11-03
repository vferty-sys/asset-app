// 대출 추가·수정 창. 갚는 방식을 고르면 설명과 적을 칸이 바뀌고, 적는 대로 이번 회차 원금·이자와 다 갚는 날을 미리 보여 준다.

import { LOAN_METHOD_HELP, LOAN_METHOD_LABELS, LOAN_METHODS, LOAN_TYPES } from '../constants.js';
import { loanStatus, paymentMismatch } from '../calc/loan.js';
import { durationText, parseMonth, todayString } from '../dates.js';
import { loanToInput, validateLoan } from '../loan.js';
import { parseNumberInput } from '../validate.js';
import { el, clear, confirmDialog, openModal, showToast, uid } from '../dom.js';
import { formatDate, formatMoney } from '../format.js';
import { createField, dateInput, numberInput, segmented, selectInput, textInput } from './form.js';

const HELP = {
  method: LOAN_METHODS.map((method) => `${LOAN_METHOD_LABELS[method]}: ${LOAN_METHOD_HELP[method]}`),
  balance: [
    '은행 앱의 "대출 잔액"(남은 원금)이에요.',
    '아래 기준일의 금액으로 보고, 그다음 갚는 날부터 매달 줄여서 오늘 남은 금액을 계산해요. 은행 앱과 차이가 나면 언제든 고쳐 주세요.',
  ],
  rate: '은행 앱의 "적용 금리"(연 %)예요. 매달 낸 돈을 원금 몫과 이자 몫으로 나누는 데 써요. 변동금리라 금리가 바뀌면 고쳐 주세요.',
};

// 방식마다 '매달 금액' 칸의 이름과 설명
const MONTHLY_FIELD = {
  equalPayment: { label: '매월 상환액', hint: '매달 빠져나가는 금액(원금 + 이자)이에요. 모르면 비우고 만기를 적어 주세요.' },
  equalPrincipal: { label: '매달 갚는 원금', hint: '매달 갚는 원금이에요(이자는 남은 원금으로 계산해요). 모르면 비우고 만기를 적어 주세요.' },
};
const MATURITY_HINT = {
  equalPayment: '매월 상환액 대신 적어도 돼요. 둘 다 적으면 서로 맞는지 확인해요.',
  equalPrincipal: '매달 갚는 원금 대신 적어도 돼요. 만기까지 원금을 똑같이 나눠 계산해요.',
  bullet: '원금을 한꺼번에 갚는 달이에요. 그전까지는 매달 이자만 내요.',
};

function emptyInput() {
  return {
    id: '', name: '', type: '주택담보대출', method: 'equalPayment', balance: '', rate: '', baseDate: todayString(),
    monthlyPayment: '', maturity: '', payDay: '', memo: '',
  };
}

const money = (value) => formatMoney(value);
// 갚을 돈·원금·이자는 은행 앱 금액과 맞춰 볼 수 있게 원 단위까지
const won = (value) => formatMoney(value, { unit: 'won' });
const shortDate = (date) => {
  const [, month, day] = date.split('-').map(Number);
  return `${month}월 ${day}일`;
};

export function openLoanForm({ loan = null, updateState }) {
  const isEdit = Boolean(loan);
  const input = isEdit ? loanToInput(loan) : emptyInput();

  const nameField = createField({ label: '이름', control: textInput({ value: input.name, placeholder: '예: 집 주택담보대출, OO은행 신용대출', maxlength: 40 }) });
  const typeField = createField({ label: '대출 종류', control: selectInput(LOAN_TYPES, input.type) });
  const methodControl = segmented({
    options: LOAN_METHODS.map((method) => [method, LOAN_METHOD_LABELS[method]]),
    value: input.method,
    onChange: () => refresh(),
  });
  const methodField = createField({ label: '갚는 방식', help: HELP.method, control: methodControl.element, group: true });
  const balanceField = createField({ label: '지금 남은 대출금', help: HELP.balance, control: numberInput({ value: input.balance, placeholder: '0' }), suffix: '원' });
  const baseDateField = createField({ label: '기준일', hint: '남은 대출금을 확인한 날이에요.', control: dateInput({ value: input.baseDate }) });
  const rateField = createField({ label: '금리 (연)', help: HELP.rate, control: textInput({ value: input.rate, inputmode: 'decimal', placeholder: '예: 4.2' }), suffix: '%' });
  const payDayField = createField({ label: '매달 갚는 날 (선택)', hint: '자동이체 날짜. 비우면 기준일과 같은 날로 계산해요.', control: textInput({ value: input.payDay, inputmode: 'numeric', placeholder: '예: 25' }), suffix: '일' });
  const monthlyField = createField({ label: MONTHLY_FIELD.equalPayment.label, control: numberInput({ value: input.monthlyPayment, placeholder: '0' }), suffix: '원' });
  const maturityField = createField({ label: '만기 (선택)', control: dateInput({ value: input.maturity, month: true }) });
  const memoField = createField({ label: '메모 (선택)', control: el('textarea', { class: 'input textarea', rows: '2', maxlength: '200', value: input.memo }) });
  const preview = el('div', { class: 'loan-preview', 'aria-live': 'polite' });

  const views = {
    name: nameField, type: typeField, method: methodField, balance: balanceField, baseDate: baseDateField, rate: rateField,
    payDay: payDayField, monthlyPayment: monthlyField, maturity: maturityField, memo: memoField,
  };

  const values = () => ({
    id: input.id,
    name: nameField.control.value,
    type: typeField.control.value,
    method: methodControl.value,
    balance: balanceField.control.value,
    rate: rateField.control.value,
    baseDate: baseDateField.control.value,
    monthlyPayment: methodControl.value === 'bullet' ? '' : monthlyField.control.value,
    maturity: maturityField.control.value,
    payDay: payDayField.control.value,
    memo: memoField.control.value,
  });

  // 방식에 맞게 칸 이름·설명을 바꾸고, 적은 값으로 이번 회차와 다 갚는 날을 미리 계산한다
  function refresh() {
    const method = methodControl.value;
    methodField.setHint(LOAN_METHOD_HELP[method]);
    monthlyField.element.hidden = method === 'bullet';
    if (method !== 'bullet') {
      monthlyField.element.querySelector('.field-label').textContent = MONTHLY_FIELD[method].label;
      monthlyField.setHint(MONTHLY_FIELD[method].hint);
    }
    maturityField.element.querySelector('.field-label').textContent = method === 'bullet' ? '만기' : '만기 (선택)';
    maturityField.setHint(MATURITY_HINT[method]);

    clear(preview);
    const draft = {
      method,
      balance: parseNumberInput(balanceField.control.value),
      rate: parseNumberInput(rateField.control.value),
      baseDate: baseDateField.control.value,
      monthlyPayment: method === 'bullet' ? null : parseNumberInput(monthlyField.control.value),
      maturity: maturityField.control.value || null,
      payDay: parseNumberInput(payDayField.control.value),
    };
    if (!(draft.balance > 0) || !Number.isFinite(draft.rate) || !draft.baseDate) {
      preview.hidden = true;
      return;
    }
    const status = loanStatus(draft, { today: todayString() });
    const lines = [];
    if (status.error === 'too-small') {
      lines.push(el('p', { class: 'warn-text', text: `매월 상환액이 한 달 이자(약 ${won(draft.balance * draft.rate / 1200)})보다 적거나 같아서 원금이 줄지 않아요.` }));
    } else if (status.error === 'no-plan') {
      lines.push(el('p', { class: 'muted', text: method === 'equalPayment' ? '매월 상환액이나 만기를 적으면 원금·이자를 나눠 보여 드려요.' : '매달 갚는 원금이나 만기를 적으면 계산해 드려요.' }));
    } else if (status.next) {
      lines.push(el('p', {},
        el('strong', { text: `${shortDate(status.next.date)} 갚을 돈 ${won(status.next.payment)}` }),
        ` = 원금 ${won(status.next.principal)} + 이자 ${won(status.next.interest)}`));
      if (status.payoffDate) {
        const months = Math.max(0, parseMonth(status.payoffDate) - parseMonth(todayString()));
        lines.push(el('p', { text: `다 갚는 날: ${formatDate(status.payoffDate)} (앞으로 ${durationText(months)}) · 앞으로 낼 이자 약 ${money(status.interestLeft)}` }));
      } else if (method === 'bullet') {
        lines.push(el('p', { class: 'muted', text: '만기를 적으면 다 갚는 날을 알려 드려요.' }));
      }
      if (status.estimated) lines.push(el('p', { class: 'muted small', text: `기준일 뒤에 갚은 회차를 빼면 오늘 남은 대출금은 약 ${money(status.balance)}이에요.` }));
    }
    const mismatch = paymentMismatch(draft);
    if (mismatch) lines.push(el('p', { class: 'warn-text', text: `만기에 맞추려면 매월 약 ${won(mismatch.expected)}이에요. 은행 앱의 금액과 맞는지 확인해 주세요.` }));
    preview.hidden = lines.length === 0;
    preview.append(...lines);
  }
  [balanceField, rateField, baseDateField, monthlyField, maturityField, payDayField].forEach((view) => {
    view.control.addEventListener('input', refresh);
    view.control.addEventListener('change', refresh);
  });

  const formId = uid('loan-form');
  const form = el('form', { class: 'form', id: formId, novalidate: true },
    nameField.element,
    typeField.element,
    methodField.element,
    el('div', { class: 'form-pair' }, balanceField.element, baseDateField.element),
    el('div', { class: 'form-pair' }, rateField.element, payDayField.element),
    el('div', { class: 'form-pair' }, monthlyField.element, maturityField.element),
    preview,
    memoField.element);
  refresh();

  const deleteButton = isEdit ? el('button', { type: 'button', class: 'btn btn-danger', text: '삭제' }) : null;
  const cancelButton = el('button', { type: 'button', class: 'btn', text: '취소' });
  const saveButton = el('button', { type: 'submit', form: formId, class: 'btn btn-primary', text: isEdit ? '저장' : '추가' });
  const { close } = openModal({ title: isEdit ? '대출 수정' : '대출 추가', body: form, footer: [deleteButton, el('span', { class: 'spacer' }), cancelButton, saveButton] });
  cancelButton.addEventListener('click', close);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const result = validateLoan(values());
    Object.entries(views).forEach(([key, view]) => view.setError(result.errors[key] ?? null));
    if (!result.ok) {
      const firstKey = Object.keys(views).find((key) => result.errors[key]);
      views[firstKey]?.element.querySelector('input, select, textarea')?.focus();
      return;
    }
    updateState((draft) => {
      const index = draft.loans.findIndex((item) => item.id === result.value.id);
      if (index >= 0) draft.loans[index] = result.value;
      else draft.loans.push(result.value);
    });
    close();
    const warning = Object.values(result.warnings)[0];
    if (warning) showToast(`저장했어요. ${warning}`, 'warn', 5000);
    else showToast(isEdit ? '저장했어요' : '대출을 추가했어요');
  });

  deleteButton?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({ title: '대출 삭제', message: `'${loan.name}'을(를) 삭제할까요? 다 갚았다면 삭제해도 돼요.`, confirmText: '삭제', danger: true });
    if (!confirmed) return;
    updateState((draft) => { draft.loans = draft.loans.filter((item) => item.id !== loan.id); });
    close();
    showToast('삭제했어요');
  });
}
