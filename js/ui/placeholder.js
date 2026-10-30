// 아직 만들지 않은 탭의 안내 화면. 각 단계에서 실제 화면으로 바뀐다.

import { el } from '../dom.js';

export function renderPlaceholder(root, { summary, items, stage }) {
  root.append(
    el('section', { class: 'card placeholder' },
      el('p', { class: 'placeholder-summary', text: summary }),
      el('ul', { class: 'placeholder-list' }, items.map((item) => el('li', { text: item }))),
      el('p', { class: 'muted small', text: `개발 ${stage}단계에서 만들어질 화면이에요.` }),
    ),
  );
}
