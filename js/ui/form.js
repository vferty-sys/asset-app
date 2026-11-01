// 입력 칸 공통 모양: 라벨(+도움말) → 입력 → (원 금액이면 한글 단위 확인) → 힌트 → 오류 문구

import { el, uid, helpTip } from '../dom.js';
import { formatNumber, formatWonExact } from '../format.js';
import { parseNumberInput } from '../validate.js';

// control이 라디오 묶음처럼 여러 입력으로 된 경우 group: true (라벨을 aria-labelledby로 연결)
// preview: 단위가 '원'인 금액 칸 아래에 '= 150만원'처럼 한글 단위로 읽어 준다 (만원 단위로 잘못 적는 실수 방지).
//          기본은 단위가 '원'이면 켠다. 주당 가격처럼 필요 없는 칸은 false
export function createField({
  label, help, hint, control, suffix, group = false, compact = false, className = '', preview = suffix === '원',
}) {
  const id = control.id || uid('field');
  control.id = id;
  const hintNode = el('p', { class: 'field-hint', id: `${id}-hint`, hidden: !hint, text: hint ?? '' });
  const errorNode = el('p', { class: 'field-error', id: `${id}-error`, role: 'alert', hidden: true });
  const previewNode = preview ? el('p', { class: 'field-preview num', id: `${id}-preview`, hidden: true }) : null;
  control.setAttribute('aria-describedby', [previewNode?.id, hintNode.id, errorNode.id].filter(Boolean).join(' '));

  const labelNode = group
    ? el('span', { class: 'field-label', id: `${id}-label`, text: label })
    : el('label', { class: 'field-label', for: id, text: label });
  if (group) control.setAttribute('aria-labelledby', labelNode.id);

  const suffixNode = suffix != null ? el('span', { class: 'input-suffix', 'aria-hidden': 'true', text: suffix }) : null;
  const classes = ['field', compact && 'field-compact', className].filter(Boolean).join(' ');
  const element = el('div', { class: classes },
    el('div', { class: 'field-label-row' }, labelNode, help ? helpTip(label, help) : null),
    suffixNode ? el('div', { class: 'input-affix' }, control, suffixNode) : control,
    previewNode,
    hintNode,
    errorNode);

  // 원 금액을 한글 단위로 (단위가 달러로 바뀌면 숨긴다)
  const updatePreview = () => {
    if (!previewNode) return;
    const amount = parseNumberInput(control.value);
    const show = suffixNode?.textContent === '원' && Number.isFinite(amount) && amount > 0;
    previewNode.hidden = !show;
    previewNode.textContent = show ? `= ${formatWonExact(amount)}` : '';
  };
  if (previewNode) {
    control.addEventListener('input', updatePreview);
    control.addEventListener('change', updatePreview);
    updatePreview();
  }

  return {
    element,
    control,
    setError(message) {
      element.classList.toggle('is-invalid', Boolean(message));
      control.setAttribute('aria-invalid', message ? 'true' : 'false');
      errorNode.textContent = message ?? '';
      errorNode.hidden = !message;
    },
    setHint(text) {
      hintNode.textContent = text ?? '';
      hintNode.hidden = !text;
    },
    setSuffix(text) {
      if (suffixNode) suffixNode.textContent = text;
      updatePreview();
    },
  };
}

// 켜기/끄기 스위치 칸
export function createToggleField({ label, help, hint, checked }) {
  const control = el('input', { type: 'checkbox', role: 'switch', class: 'switch-input', id: uid('toggle'), checked });
  const hintNode = el('p', { class: 'field-hint', id: `${control.id}-hint`, hidden: !hint, text: hint ?? '' });
  control.setAttribute('aria-describedby', hintNode.id);
  const element = el('div', { class: 'field field-toggle' },
    el('div', { class: 'toggle-row' },
      el('div', { class: 'field-label-row' },
        el('label', { class: 'field-label', for: control.id, text: label }),
        help ? helpTip(label, help) : null),
      el('span', { class: 'switch' }, control, el('span', { class: 'switch-track', 'aria-hidden': 'true' }))),
    hintNode);
  return { element, control };
}

// options: ['값', ...] 또는 [['값', '보이는 이름'], ...]
export function selectInput(options, value, { placeholder } = {}) {
  const pairs = options.map((option) => (Array.isArray(option) ? option : [option, option]));
  return el('select', { class: 'input', value: value ?? '' },
    placeholder != null ? el('option', { value: '', disabled: true, text: placeholder }) : null,
    pairs.map(([optionValue, label]) => el('option', { value: String(optionValue), text: label })));
}

export function textInput({ value = '', placeholder, inputmode, type = 'text', maxlength } = {}) {
  return el('input', {
    type, class: 'input', value, placeholder, inputmode, maxlength, autocomplete: 'off',
  });
}

// 숫자 칸: 읽기 쉽게 쉼표를 넣어 보여준다. (검증 때는 쉼표를 무시한다)
export function numberInput({ value = '', placeholder } = {}) {
  const withCommas = (text) => {
    const n = parseNumberInput(text);
    return Number.isFinite(n) ? formatNumber(n, { maximumFractionDigits: 8 }) : text;
  };
  const input = textInput({ value: withCommas(value), placeholder, inputmode: 'decimal' });
  input.addEventListener('change', () => { input.value = withCommas(input.value); });
  return input;
}

// 시나리오별 낮음·기준·높음 세 칸 (연 이율·기대 수익률)
export function createScenarioField({ label, help, hint, values = {}, allowNegative = false }) {
  const parts = [['low', '낮음'], ['base', '기준'], ['high', '높음']].map(([key, name]) => {
    // iOS 숫자 키패드에는 마이너스가 없어서, 음수가 필요한 칸은 일반 키보드를 쓴다.
    const control = textInput({ value: values[key] ?? '', inputmode: allowNegative ? null : 'decimal' });
    return { key, view: createField({ label: name, control, suffix: '%', compact: true }) };
  });
  const hintNode = el('p', { class: 'field-hint', hidden: !hint, text: hint ?? '' });
  const errorNode = el('p', { class: 'field-error', role: 'alert', hidden: true });
  const element = el('fieldset', { class: 'field field-group' },
    el('legend', { class: 'field-legend' }, el('span', { class: 'field-label', text: label }), help ? helpTip(label, help) : null),
    el('div', { class: 'field-group-row' }, parts.map((part) => part.view.element)),
    hintNode,
    errorNode);
  return {
    element,
    getValues: () => Object.fromEntries(parts.map(({ key, view }) => [key, view.control.value])),
    setError(message) {
      element.classList.toggle('is-invalid', Boolean(message));
      errorNode.textContent = message ?? '';
      errorNode.hidden = !message;
    },
  };
}

// 날짜('YYYY-MM-DD')·달('YYYY-MM') 입력. 달 입력을 지원하지 않는 브라우저에서는 글자 칸이 되므로 예시를 보여준다.
export function dateInput({ value = '', month = false } = {}) {
  return el('input', {
    type: month ? 'month' : 'date', class: 'input', value: value ?? '', placeholder: month ? '2040-12' : '2026-10-30',
  });
}

// 여러 개 중 하나를 고르는 버튼 묶음 (라디오)
export function segmented({ options, value, onChange }) {
  const name = uid('segment');
  const element = el('div', { class: 'segmented', role: 'radiogroup' },
    options.map(([optionValue, label]) => el('label', { class: 'segmented-option' },
      el('input', {
        type: 'radio', name, value: optionValue, checked: optionValue === value,
        onChange: (event) => onChange?.(event.target.value),
      }),
      el('span', { text: label }))));
  return {
    element,
    get value() {
      return element.querySelector('input:checked')?.value ?? '';
    },
    set value(next) {
      element.querySelectorAll('input').forEach((input) => { input.checked = input.value === next; });
    },
  };
}
