// 부동산(집 등) 추가·수정 창. 시세는 직접 적고 1년에 한두 번 고친다.

import { REAL_ESTATE_KINDS } from '../constants.js';
import { todayString } from '../dates.js';
import { realEstateToInput, validateRealEstate } from '../real-estate.js';
import { el, confirmDialog, openModal, showToast, uid } from '../dom.js';
import { createField, dateInput, numberInput, selectInput, textInput } from './form.js';

const VALUE_HELP = [
  '지금 팔면 받을 수 있을 만한 가격이에요. 같은 단지·같은 평형의 최근 실거래가나 부동산 앱 시세를 참고해 적어 주세요.',
  '층·동에 따라 차이가 있으니 대략이면 돼요. 1년에 한두 번 고쳐 주세요.',
];

export function openRealEstateForm({ item = null, updateState }) {
  const isEdit = Boolean(item);
  const input = isEdit ? realEstateToInput(item) : { id: '', name: '', kind: '아파트', value: '', baseDate: todayString(), memo: '' };

  const nameField = createField({ label: '이름', control: textInput({ value: input.name, placeholder: '예: 우리 집, OO아파트 101동', maxlength: 40 }) });
  const kindField = createField({ label: '종류', control: selectInput(REAL_ESTATE_KINDS, input.kind) });
  const valueField = createField({ label: '시세', help: VALUE_HELP, control: numberInput({ value: input.value, placeholder: '0' }), suffix: '원' });
  const baseDateField = createField({ label: '기준일', hint: '시세를 확인한 날이에요.', control: dateInput({ value: input.baseDate }) });
  const memoField = createField({ label: '메모 (선택)', control: el('textarea', { class: 'input textarea', rows: '2', maxlength: '200', value: input.memo }) });
  const views = { name: nameField, kind: kindField, value: valueField, baseDate: baseDateField, memo: memoField };

  const formId = uid('real-estate-form');
  const form = el('form', { class: 'form', id: formId, novalidate: true },
    nameField.element, kindField.element, el('div', { class: 'form-pair' }, valueField.element, baseDateField.element), memoField.element);

  const deleteButton = isEdit ? el('button', { type: 'button', class: 'btn btn-danger', text: '삭제' }) : null;
  const cancelButton = el('button', { type: 'button', class: 'btn', text: '취소' });
  const saveButton = el('button', { type: 'submit', form: formId, class: 'btn btn-primary', text: isEdit ? '저장' : '추가' });
  const { close } = openModal({ title: isEdit ? '부동산 수정' : '부동산 추가', body: form, footer: [deleteButton, el('span', { class: 'spacer' }), cancelButton, saveButton] });
  cancelButton.addEventListener('click', close);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const result = validateRealEstate({
      id: input.id, name: nameField.control.value, kind: kindField.control.value, value: valueField.control.value,
      baseDate: baseDateField.control.value, memo: memoField.control.value,
    });
    Object.entries(views).forEach(([key, view]) => view.setError(result.errors[key] ?? null));
    if (!result.ok) {
      const firstKey = Object.keys(views).find((key) => result.errors[key]);
      views[firstKey]?.element.querySelector('input, select, textarea')?.focus();
      return;
    }
    updateState((draft) => {
      const index = draft.realEstate.findIndex((entry) => entry.id === result.value.id);
      if (index >= 0) draft.realEstate[index] = result.value;
      else draft.realEstate.push(result.value);
    });
    close();
    showToast(isEdit ? '저장했어요' : '부동산을 추가했어요');
  });

  deleteButton?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({ title: '부동산 삭제', message: `'${item.name}'을(를) 삭제할까요?`, confirmText: '삭제', danger: true });
    if (!confirmed) return;
    updateState((draft) => { draft.realEstate = draft.realEstate.filter((entry) => entry.id !== item.id); });
    close();
    showToast('삭제했어요');
  });
}
