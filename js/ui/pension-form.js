// 연금 추가·수정 창. 추가할 때는 먼저 종류(확정 수령형 / 적립형)를 고르고, 그 종류에 맞는 칸만 보여준다.

import { LINKABLE_ACCOUNTS, PAYOUT_TYPES, PENSION_CATEGORIES } from '../constants.js';
import { formatMonthIndex, monthIndexAtAge, todayString } from '../dates.js';
import { INFLATION_INDEXED_CATEGORIES, pensionToInput, validatePension } from '../pension.js';
import { parseNumberInput } from '../validate.js';
import { el, confirmDialog, openModal, showToast, uid } from '../dom.js';
import { formatMoney } from '../format.js';
import {
  createField, createScenarioField, createToggleField, dateInput, numberInput, segmented, selectInput, textInput,
} from './form.js';

const KIND_CHOICES = [
  ['fixed', '확정 수령형', '공무원연금·국민연금처럼 받을 금액을 기관에서 조회할 수 있는 연금'],
  ['accumulating', '적립형', '연금저축·IRP처럼 모은 돈을 굴려서 나눠 받는 연금'],
];

const HELP = {
  startAge: '연금을 받기 시작하는 나이예요. 설정의 출생연도·출생월로 받기 시작하는 달을 계산해요.',
  payoutType: '종신은 평생 받는 연금이에요. 계산할 때는 설정의 기대 수명까지 받는다고 봐요.',
  applyTax: '연금을 받을 때 떼는 세금을 아래 세율 하나로 단순하게 빼요. 실제 세금과는 다를 수 있어요.',
  expected: '연금공단·공무원연금공단 등에서 조회한 예상 월 수령액이에요.',
  basis: [
    '현재가치: 물가를 생각해 지금 돈 가치로 바꾼 금액이에요.',
    '미래 금액: 실제로 받기 시작할 때 받는 금액이에요.',
  ],
  indexed: '켜면 받는 동안 해마다 물가만큼 금액이 올라요. 공무원연금·국민연금은 보통 물가에 맞춰 올라요.',
  linked: '보유 종목에 입력한 연금저축·IRP 계좌의 종목 금액을 적립금으로 써요. 같은 돈이 총자산에 두 번 더해지지 않아요.',
  returns: [
    '적립금이 1년에 평균 몇 % 불어날지에 대한 가정이에요. 받는 동안에도 같은 수익률이 붙는다고 봐요.',
    '낮음·높음을 비우면 기준과 같은 값으로 계산해요.',
  ],
};

const TAX_RATE_HINT = '연금저축·IRP는 받는 나이에 따라 5.5%(70세 전) · 4.4%(70대) · 3.3%(80세부터)예요. 공무원·국민연금은 다른 소득과 합쳐 계산해서 사람마다 달라요.';

function emptyInput(kind) {
  const common = {
    id: '', name: '', kind, startAge: '', payoutType: '종신', payoutYears: '', applyTax: true, memo: '',
  };
  if (kind === 'fixed') {
    return { ...common, category: '국민연금', expectedMonthlyAmount: '', amountBasis: '', inflationIndexed: true, inquiryDate: '' };
  }
  return {
    ...common, category: '연금저축', payoutType: '기간 지정', payoutYears: '20', linkedAccount: '', balance: '', baseDate: todayString(),
    monthlyContribution: '', contributionEndDate: '', expectedReturns: { low: '', base: '', high: '' },
  };
}

// 종류 고르기 창
export function openPensionKindChooser(onChoose) {
  const { close } = openModal({
    title: '연금 추가 — 종류 고르기',
    size: 'sm',
    body: el('div', { class: 'kind-choices' }, KIND_CHOICES.map(([kind, label, description]) => {
      const button = el('button', { type: 'button', class: 'kind-choice' }, el('strong', { text: label }), el('span', { text: description }));
      button.addEventListener('click', () => {
        close();
        onChoose(kind);
      });
      return button;
    })),
  });
}

// accountValues: { 연금저축: 원화 평가금액, IRP: … } — 계좌 연결 안내용
export function openPensionForm({ pension = null, kind = pension?.kind ?? 'fixed', getState, updateState, accountValues = {} }) {
  const isEdit = Boolean(pension);
  const { settings } = getState();
  // 새 연금의 세율은 설정의 '연금 세율 기본값'으로 시작
  const input = isEdit ? pensionToInput(pension) : { ...emptyInput(kind), taxRate: String(settings.pensionTaxRate) };
  const money = (value) => formatMoney(value, { unit: settings.displayUnit });
  let indexedTouched = isEdit;

  // ── 공통 ──
  const nameField = createField({ label: '이름', control: textInput({ value: input.name, placeholder: kind === 'fixed' ? '예: 공무원연금' : '예: 연금저축-A증권', maxlength: 40 }) });
  const categoryField = createField({ label: '분류', control: selectInput(PENSION_CATEGORIES, input.category) });
  const startAgeField = createField({ label: '수령 개시 연령', help: HELP.startAge, control: textInput({ value: input.startAge, inputmode: 'numeric', placeholder: '예: 65' }), suffix: '세' });
  const payoutControl = segmented({ options: PAYOUT_TYPES.map((type) => [type, type]), value: input.payoutType, onChange: () => refresh() });
  const payoutField = createField({ label: '받는 방식', help: HELP.payoutType, control: payoutControl.element, group: true });
  const yearsField = createField({ label: '받는 기간', control: textInput({ value: input.payoutYears, inputmode: 'numeric', placeholder: '예: 20' }), suffix: '년' });
  const taxToggle = createToggleField({ label: '세금 빼고 계산', help: HELP.applyTax, checked: input.applyTax });
  const taxRateField = createField({ label: '연금 세율', hint: TAX_RATE_HINT, control: textInput({ value: input.taxRate, inputmode: 'decimal' }), suffix: '%' });
  taxToggle.control.addEventListener('change', () => refresh());
  const memoField = createField({ label: '메모 (선택)', control: el('textarea', { class: 'input textarea', rows: '2', maxlength: '200', value: input.memo }) });

  const views = {
    name: nameField, category: categoryField, startAge: startAgeField, payoutType: payoutField, payoutYears: yearsField,
    taxRate: taxRateField, memo: memoField,
  };
  const kindFields = [];

  // ── 확정 수령형 ──
  let fixedParts = null;
  if (kind === 'fixed') {
    const basisControl = segmented({ options: [['present', '현재가치'], ['future', '미래 금액']], value: input.amountBasis });
    const indexedToggle = createToggleField({ label: '물가연동', help: HELP.indexed, checked: input.inflationIndexed });
    indexedToggle.control.addEventListener('change', () => { indexedTouched = true; });
    fixedParts = {
      expected: createField({ label: '예상 월 수령액', help: HELP.expected, control: numberInput({ value: input.expectedMonthlyAmount, placeholder: '0' }), suffix: '원' }),
      basis: createField({ label: '금액 기준', help: HELP.basis, hint: '조회 화면의 안내 문구에서 금액 기준을 확인하세요.', control: basisControl.element, group: true }),
      basisControl,
      indexed: indexedToggle,
      inquiry: createField({ label: '조회 기준일 (선택)', control: dateInput({ value: input.inquiryDate }) }),
    };
    Object.assign(views, { expectedMonthlyAmount: fixedParts.expected, amountBasis: fixedParts.basis, inquiryDate: fixedParts.inquiry });
    kindFields.push(fixedParts.expected.element, fixedParts.basis.element, fixedParts.indexed.element, fixedParts.inquiry.element);
    // 공무원연금·국민연금을 고르면 물가연동을 켠다 (직접 바꾼 적이 없을 때만)
    categoryField.control.addEventListener('change', () => {
      if (!indexedTouched) indexedToggle.control.checked = INFLATION_INDEXED_CATEGORIES.includes(categoryField.control.value);
    });
  }

  // ── 적립형 ──
  let accParts = null;
  if (kind === 'accumulating') {
    const linkOptions = [['', '연결 안 함'], ...LINKABLE_ACCOUNTS.map((account) => [account, `${account} 계좌`])];
    accParts = {
      linked: createField({ label: '보유 종목 계좌와 연결', help: HELP.linked, control: selectInput(linkOptions, input.linkedAccount) }),
      balance: createField({ label: '현재 적립금', control: numberInput({ value: input.balance, placeholder: '0' }), suffix: '원' }),
      baseDate: createField({ label: '적립금 기준일', control: dateInput({ value: input.baseDate }) }),
      monthly: createField({ label: '월 납입액 (선택)', control: numberInput({ value: input.monthlyContribution, placeholder: '0' }), suffix: '원' }),
      end: createField({ label: '납입 종료 시점', hint: '매달 넣는 돈이 없으면 비워 두세요.', control: dateInput({ value: input.contributionEndDate, month: true }) }),
      returns: createScenarioField({ label: '예상 연 수익률', help: HELP.returns, values: input.expectedReturns, allowNegative: true }),
    };
    accParts.balancePair = el('div', { class: 'form-pair' }, accParts.balance.element, accParts.baseDate.element);
    accParts.linked.control.addEventListener('change', () => refresh());
    Object.assign(views, {
      linkedAccount: accParts.linked, balance: accParts.balance, baseDate: accParts.baseDate,
      monthlyContribution: accParts.monthly, contributionEndDate: accParts.end, expectedReturns: accParts.returns,
    });
    kindFields.push(
      accParts.linked.element,
      accParts.balancePair,
      el('div', { class: 'form-pair' }, accParts.monthly.element, accParts.end.element),
      accParts.returns.element,
    );
  }

  // 받는 방식·계좌 연결에 따라 보이는 칸과 안내를 바꾼다
  function refresh() {
    yearsField.element.hidden = payoutControl.value !== '기간 지정';
    taxRateField.element.hidden = !taxToggle.control.checked;
    const age = parseNumberInput(startAgeField.control.value);
    startAgeField.setHint(settings.birthYear && Number.isInteger(age) && age >= 40 && age <= 100
      ? `${formatMonthIndex(monthIndexAtAge(age, settings.birthYear, settings.birthMonth))}부터 받아요.`
      : (settings.birthYear ? '' : '설정에 출생연도를 넣으면 받기 시작하는 달을 알려드려요.'));
    if (accParts) {
      const account = accParts.linked.control.value;
      accParts.balancePair.hidden = Boolean(account);
      const value = accountValues[account] ?? 0;
      accParts.linked.setHint(account
        ? (value > 0 ? `${account} 계좌 보유 종목 ${money(value)}을 적립금으로 써요.` : `${account} 계좌에 보유 종목이 없어요. 보유 종목에서 ${account} 계좌 종목을 추가해 주세요.`)
        : '');
    }
  }
  startAgeField.control.addEventListener('input', refresh);

  const formId = uid('pension-form');
  const form = el('form', { class: 'form', id: formId, novalidate: true },
    el('p', { class: 'badge badge-info kind-badge', text: KIND_CHOICES.find(([value]) => value === kind)[1] }),
    nameField.element,
    categoryField.element,
    kindFields,
    el('div', { class: 'form-pair' }, startAgeField.element, payoutField.element),
    yearsField.element,
    taxToggle.element,
    taxRateField.element,
    memoField.element);
  refresh();

  const deleteButton = isEdit ? el('button', { type: 'button', class: 'btn btn-danger', text: '삭제' }) : null;
  const cancelButton = el('button', { type: 'button', class: 'btn', text: '취소' });
  const saveButton = el('button', { type: 'submit', form: formId, class: 'btn btn-primary', text: isEdit ? '저장' : '추가' });
  const { close } = openModal({
    title: isEdit ? '연금 수정' : '연금 추가',
    body: form,
    footer: [deleteButton, el('span', { class: 'spacer' }), cancelButton, saveButton],
  });
  cancelButton.addEventListener('click', close);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const state = getState();
    const values = {
      id: input.id,
      name: nameField.control.value,
      category: categoryField.control.value,
      kind,
      startAge: startAgeField.control.value,
      payoutType: payoutControl.value,
      payoutYears: yearsField.control.value,
      applyTax: taxToggle.control.checked,
      taxRate: taxRateField.control.value,
      memo: memoField.control.value,
    };
    if (fixedParts) {
      Object.assign(values, {
        expectedMonthlyAmount: fixedParts.expected.control.value,
        amountBasis: fixedParts.basisControl.value,
        inflationIndexed: fixedParts.indexed.control.checked,
        inquiryDate: fixedParts.inquiry.control.value,
      });
    }
    if (accParts) {
      Object.assign(values, {
        linkedAccount: accParts.linked.control.value,
        balance: accParts.balance.control.value,
        baseDate: accParts.baseDate.control.value,
        monthlyContribution: accParts.monthly.control.value,
        contributionEndDate: accParts.end.control.value,
        expectedReturns: accParts.returns.getValues(),
      });
    }
    const result = validatePension(values, {
      existing: state.pensions, birthYear: state.settings.birthYear, birthMonth: state.settings.birthMonth,
      defaultTaxRate: state.settings.pensionTaxRate,
    });
    Object.entries(views).forEach(([key, view]) => view.setError(result.errors[key] ?? null));
    if (!result.ok) {
      const firstKey = Object.keys(views).find((key) => result.errors[key]);
      views[firstKey]?.element.querySelector('input, select, textarea')?.focus();
      return;
    }
    updateState((draft) => {
      const index = draft.pensions.findIndex((item) => item.id === result.value.id);
      if (index >= 0) draft.pensions[index] = result.value;
      else draft.pensions.push(result.value);
    });
    close();
    const warning = Object.values(result.warnings)[0];
    if (warning) showToast(`저장했어요. ${warning}`, 'warn', 5000);
    else showToast(isEdit ? '저장했어요' : '연금을 추가했어요');
  });

  deleteButton?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: '연금 삭제', message: `'${pension.name}'을(를) 삭제할까요? 삭제하면 되돌릴 수 없어요.`, confirmText: '삭제', danger: true,
    });
    if (!confirmed) return;
    updateState((draft) => { draft.pensions = draft.pensions.filter((item) => item.id !== pension.id); });
    close();
    showToast('삭제했어요');
  });
}
