// 종목명 칸 자동완성: 글자를 치면 종목 목록에서 후보를 보여주고, 고르면 onPick(종목)을 부른다.
// 키보드: ↑↓로 고르고 Enter로 정하고 Esc로 닫는다 (combobox 접근성 패턴).

import { searchStocks } from '../stock-list.js';
import { el, uid } from '../dom.js';

const TYPE_LABELS = { stock: '주식', etf: 'ETF' };

// field: 입력칸이 들어 있는 칸(.field) 요소, getItems: 지금까지 받은 종목 목록 (아직 없으면 [])
export function attachStockPicker({ input, field, getItems, onPick }) {
  const listId = uid('stock-options');
  const list = el('ul', { class: 'picker-list', id: listId, role: 'listbox', 'aria-label': '종목 후보', hidden: true });
  field.classList.add('picker-field');
  input.after(list);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', listId);
  input.autocomplete = 'off';

  let results = [];
  let active = -1;

  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function highlight(index) {
    active = index;
    [...list.children].forEach((option, i) => option.setAttribute('aria-selected', String(i === index)));
    if (index >= 0) {
      input.setAttribute('aria-activedescendant', `${listId}-${index}`);
      list.children[index]?.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function choose(index) {
    const item = results[index];
    close();
    if (item) onPick(item);
  }

  function open() {
    results = searchStocks(getItems(), input.value);
    if (results.length === 0) {
      close();
      return;
    }
    list.replaceChildren(...results.map((item, index) => el('li', {
      id: `${listId}-${index}`,
      class: 'picker-option',
      role: 'option',
      'aria-selected': 'false',
      // 입력칸에서 초점이 빠지기 전에 고르도록 mousedown에서 처리
      onMousedown: (event) => {
        event.preventDefault();
        choose(index);
      },
    },
    el('span', { class: 'picker-name', text: item.name }),
    el('span', { class: 'picker-meta', text: [item.ticker, TYPE_LABELS[item.type], item.aliases[0]].filter(Boolean).join(' · ') }))));
    list.style.top = `${input.offsetTop + input.offsetHeight + 4}px`;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight(-1);
  }

  input.addEventListener('input', open);
  input.addEventListener('keydown', (event) => {
    if (list.hidden) {
      if (event.key === 'ArrowDown' && input.value) open();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlight(Math.min(active + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlight(Math.max(active - 1, 0));
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault(); // 창의 저장 버튼이 눌리지 않게
      choose(active);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation(); // 창 전체가 닫히지 않게
      close();
    }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));

  return {
    // 목록을 다 받은 뒤, 이미 친 글자로 다시 찾는다
    refresh() {
      if (document.activeElement === input && input.value) open();
    },
    close,
  };
}
