// 입력 칸 공통 모양: 라벨(+도움말) → 입력 → 힌트 → 오류 문구

import { el, uid, helpTip } from '../dom.js';
import { formatNumber } from '../format.js';
import { parseNumberInput } from '../validate.js';

// control이 라디오 묶음처럼 여러 입력으로 된 경우 group: true (라벨을 aria-labelledby로 연결)
export function createField({ label, help, hint, control, suffix, group = false, compact = false, className = '' }) {
  const id = control.id || uid('field');
  control.id = id;
  const hintNode = el('p', { class: 'field-hint', id: `${id}-hint`, hidden: !hint, text: hint ?? '' });
  const errorNode = el('p', { class: 'field-error', id: `${id}-error`, role: 'alert', hidden: true });
  control.setAttribute('aria-describedby', `${hintNode.id} ${errorNode.id}`);

  const labelNode = group
    ? el('span', { class: 'field-label', id: `${id}-label`, text: label })
    : el('label', { class: 'field-label', for: id, text: label });
  if (group) control.setAttribute('aria-labelledby', labelNode.id);

  const suffixNode = suffix != null ? el('span', { class: 'input-suffix', 'aria-hidden': 'true', text: suffix }) : null;
  const classes = ['field', compact && 'field-compact', className].filter(Boolean).join(' ');
  const element = el('div', { class: classes },
    el('div', { class: 'field-label-row' }, labelNode, help ? helpTip(label, help) : null),
    suffixNode ? el('div', { class: 'input-affix' }, control, suffixNode) : control,
    hintNode,
    errorNode);

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
