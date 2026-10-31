// 공제회·예적금 추가·수정 창

import { COMPOUNDING_TYPES, OTHER_ASSET_TYPES } from '../constants.js';
import { todayString } from '../dates.js';
import { defaultTaxRate, otherAssetToInput, validateOtherAsset } from '../other-asset.js';
import { parseNumberInput } from '../validate.js';
import { el, confirmDialog, openModal, showToast, uid } from '../dom.js';
import { formatMoney } from '../format.js';
import {
  createField, createScenarioField, createToggleField, dateInput, numberInput, segmented, selectInput, textInput,
} from './form.js';

const HELP = {
  principal: '지금까지 넣은 돈(원금)이에요. 공제회·은행 앱에서 원금(납입 원금)을 확인해 넣어 주세요.',
  interest: [
    '기준일까지 붙은 이자예요. 공제회에 따라 "부가금"이라고도 해요.',
    '넣어 두면 받을 때 이 이자에도 세금을 매겨서 세후 금액이 더 정확해요. 모르면 비워 두세요(앞으로 붙을 이자에만 세금을 매겨요).',
  ],
  growth: '해마다 월 납입액을 몇 % 올리는지예요. 납입액이 늘지 않으면 비워 두세요.',
  rates: [
    '1년에 붙는 이자율이에요. 미래는 알 수 없으니 낮음·기준·높음 세 가지로 계산해 봐요.',
    '예금처럼 이율이 정해져 있으면 기준만 넣으세요. 낮음·높음을 비우면 기준과 같은 값으로 계산해요.',
  ],
  compounding: [
    '월복리: 매달 이자가 붙고, 그 이자에도 다시 이자가 붙어요. 공제회·은행 앱에서 달마다 붙는 이자가 보이면 월복리예요.',
    '연복리: 이자를 1년 동안 모아 두었다가 1년마다 붙여요.',
    '단리: 넣은 돈에만 이자가 붙어요.',
  ],
  payout: '돈을 찾을(해지할) 예정인 때예요. 납입이 끝난 뒤 이때까지는 넣는 돈 없이 이자만 붙어요.',
  tax: [
    '이자에서 세금을 빼고 계산해요. 받을 때 한꺼번에 떼는 것으로 단순하게 계산해서 실제와 조금 다를 수 있어요.',
    '세금이 없는 상품이면 끄세요.',
  ],
};

const TAX_HINTS = {
  공제회: '공제회 급여는 납입 기간에 따라 세금을 많이 깎아 줘서 보통 몇 %예요. 공제회 앱의 세후 예상 수령액을 보고 맞게 고쳐 주세요.',
  기본: '예금·적금 이자에는 보통 15.4%(이자소득세 14% + 지방소득세 1.4%)가 붙어요.',
};

function emptyInput() {
  return {
    id: '', name: '', type: '공제회', principal: '', accruedInterest: '', baseDate: todayString(), monthlyContribution: '', contributionGrowthRate: '',
    interestRates: { low: '', base: '', high: '' }, compounding: '월복리', contributionEndDate: '', payoutDate: '',
    applyTax: true, taxRate: String(defaultTaxRate('공제회')),
  };
}

export function openOtherAssetForm({ asset = null, updateState }) {
  const isEdit = Boolean(asset);
  const input = isEdit ? otherAssetToInput(asset) : emptyInput();
  let currentType = input.type;

  const nameField = createField({ label: '이름', control: textInput({ value: input.name, placeholder: '예: 행정공제회, OO은행 정기예금', maxlength: 40 }) });
  const typeControl = segmented({ options: OTHER_ASSET_TYPES.map((type) => [type, type]), value: input.type, onChange: (next) => changeType(next) });
  const typeField = createField({ label: '종류', control: typeControl.element, group: true });
  const principalField = createField({ label: '원금', help: HELP.principal, control: numberInput({ value: input.principal, placeholder: '0' }), suffix: '원' });
  const interestField = createField({ label: '지금까지 붙은 이자 (선택)', help: HELP.interest, control: numberInput({ value: input.accruedInterest, placeholder: '0' }), suffix: '원' });
  const baseDateField = createField({ label: '적립금 기준일', hint: '원금과 이자를 확인한 날이에요.', control: dateInput({ value: input.baseDate }) });
  const monthlyField = createField({ label: '월 납입액 (선택)', control: numberInput({ value: input.monthlyContribution, placeholder: '0' }), suffix: '원' });
  const growthField = createField({ label: '납입액 연 증액률 (선택)', help: HELP.growth, control: textInput({ value: input.contributionGrowthRate, inputmode: 'decimal', placeholder: '0' }), suffix: '%' });
  const ratesField = createScenarioField({ label: '연 이율', help: HELP.rates, values: input.interestRates, hint: '낮음·높음을 비우면 기준과 같은 값으로 계산해요.' });
  const compoundingField = createField({ label: '이자 계산 방식', help: HELP.compounding, control: selectInput(COMPOUNDING_TYPES, input.compounding) });
  const endField = createField({ label: '납입 종료 시점', hint: '매달 넣는 돈이 없으면 비워 두세요.', control: dateInput({ value: input.contributionEndDate, month: true }) });
  const payoutField = createField({ label: '수령(해지) 예정 시점', help: HELP.payout, control: dateInput({ value: input.payoutDate, month: true }) });
  const taxToggle = createToggleField({ label: '세금 빼고 계산', help: HELP.tax, checked: input.applyTax });
  const taxRateField = createField({ label: '이자 세율', control: textInput({ value: input.taxRate, inputmode: 'decimal' }), suffix: '%' });

  const views = {
    name: nameField, type: typeField, principal: principalField, accruedInterest: interestField, baseDate: baseDateField, monthlyContribution: monthlyField,
    contributionGrowthRate: growthField, interestRates: ratesField, compounding: compoundingField,
    contributionEndDate: endField, payoutDate: payoutField, taxRate: taxRateField,
  };

  // 종류를 바꾸면 세율도 그 종류의 기본값으로 (직접 고친 세율은 그대로 둔다)
  function changeType(next) {
    if (parseNumberInput(taxRateField.control.value) === defaultTaxRate(currentType)) {
      taxRateField.control.value = String(defaultTaxRate(next));
    }
    currentType = next;
    refresh();
  }

  // 현재 적립금(원금 + 이자), 세율 칸과 안내, 월복리면 다음 달 이자 (공제회·은행 앱의 이자와 맞는지 비교용)
  function refresh() {
    const principal = parseNumberInput(principalField.control.value);
    const interest = parseNumberInput(interestField.control.value);
    const balance = (Number.isFinite(principal) ? principal : 0) + (Number.isFinite(interest) ? interest : 0);
    interestField.setHint(balance > 0 ? `현재 적립금(원금 + 이자) ${formatMoney(balance, { unit: 'won' })}` : '');
    taxRateField.element.hidden = !taxToggle.control.checked;
    taxRateField.setHint(TAX_HINTS[currentType] ?? TAX_HINTS.기본);
    const rate = parseNumberInput(ratesField.getValues().base);
    const monthlyInterest = compoundingField.control.value === '월복리' && balance > 0 && rate > 0 ? (balance * rate) / 100 / 12 : null;
    compoundingField.setHint(monthlyInterest != null
      ? `지금 적립금이면 다음 달 이자는 약 ${formatMoney(monthlyInterest, { unit: 'won' })}이에요(세전, 기준 이율). 공제회·은행 앱의 이자와 비교해 보세요.`
      : '');
  }
  taxToggle.control.addEventListener('change', refresh);
  compoundingField.control.addEventListener('change', refresh);
  principalField.control.addEventListener('input', refresh);
  interestField.control.addEventListener('input', refresh);
  ratesField.element.addEventListener('input', refresh);

  const formId = uid('other-asset-form');
  const form = el('form', { class: 'form', id: formId, novalidate: true },
    nameField.element,
    typeField.element,
    el('div', { class: 'form-pair' }, principalField.element, interestField.element),
    baseDateField.element,
    el('div', { class: 'form-pair' }, monthlyField.element, growthField.element),
    ratesField.element,
    compoundingField.element,
    el('div', { class: 'form-pair' }, endField.element, payoutField.element),
    taxToggle.element,
    taxRateField.element);
  refresh();

  const deleteButton = isEdit ? el('button', { type: 'button', class: 'btn btn-danger', text: '삭제' }) : null;
  const cancelButton = el('button', { type: 'button', class: 'btn', text: '취소' });
  const saveButton = el('button', { type: 'submit', form: formId, class: 'btn btn-primary', text: isEdit ? '저장' : '추가' });
  const { close } = openModal({
    title: isEdit ? '공제회·예적금 수정' : '공제회·예적금 추가',
    body: form,
    footer: [deleteButton, el('span', { class: 'spacer' }), cancelButton, saveButton],
  });
  cancelButton.addEventListener('click', close);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const result = validateOtherAsset({
      id: input.id,
      name: nameField.control.value,
      type: typeControl.value,
      principal: principalField.control.value,
      accruedInterest: interestField.control.value,
      baseDate: baseDateField.control.value,
      monthlyContribution: monthlyField.control.value,
      contributionGrowthRate: growthField.control.value,
      interestRates: ratesField.getValues(),
      compounding: compoundingField.control.value,
      contributionEndDate: endField.control.value,
      payoutDate: payoutField.control.value,
      applyTax: taxToggle.control.checked,
      taxRate: taxRateField.control.value,
    });
    Object.entries(views).forEach(([key, view]) => view.setError(result.errors[key] ?? null));
    if (!result.ok) {
      const firstKey = Object.keys(views).find((key) => result.errors[key]);
      views[firstKey].element.querySelector('input, select')?.focus();
      return;
    }
    updateState((draft) => {
      const index = draft.otherAssets.findIndex((item) => item.id === result.value.id);
      if (index >= 0) draft.otherAssets[index] = result.value;
      else draft.otherAssets.push(result.value);
    });
    close();
    const warning = Object.values(result.warnings)[0];
    if (warning) showToast(`저장했어요. ${warning}`, 'warn', 5000);
    else showToast(isEdit ? '저장했어요' : '추가했어요');
  });

  deleteButton?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: '삭제', message: `'${asset.name}'을(를) 삭제할까요? 삭제하면 되돌릴 수 없어요.`, confirmText: '삭제', danger: true,
    });
    if (!confirmed) return;
    updateState((draft) => { draft.otherAssets = draft.otherAssets.filter((item) => item.id !== asset.id); });
    close();
    showToast('삭제했어요');
  });
}
