// 보유 종목 히트맵: 칸 크기 = 평가금액, 색 = 수익률 (이익 빨강·손실 파랑, 설정에서 바꾼 손익 색을 따른다)
// 칸 배치는 ../calc/treemap.js가 계산하고, 여기서는 % 위치로 그린다. 칸을 누르면 onSelect(item).

import { FULL_TONE_RETURN, heatmapItems, returnTone, squarify } from '../calc/treemap.js';
import { el } from '../dom.js';
import { formatPercent, formatPercentShort } from '../format.js';

// 넓은 화면은 가로로 길게, 휴대폰은 조금 세로로 긴 사각형
export const HEATMAP_WIDE_QUERY = '(min-width: 768px)';
const aspectRatio = () => (globalThis.matchMedia?.(HEATMAP_WIDE_QUERY).matches ? 2.2 : 0.85);

// 색이 진하면 흰 글자
const STRONG_TONE = 0.55;

function tileBackground({ tone, strength }) {
  if (tone === 'flat') return 'background: var(--surface-2)';
  const percent = Math.round(strength * 100);
  // color-mix를 모르는 브라우저는 앞의 진한 색을 쓴다
  return `background: var(--${tone}); background: color-mix(in srgb, var(--${tone}) ${percent}%, var(--surface-2))`;
}

const pct = (value) => `${Math.round(value * 10000) / 100}%`;

// rows: valuePortfolio(...).rows, money: 금액 표시 함수
export function holdingsHeatmap({ rows, money, onSelect }) {
  const items = heatmapItems(rows);
  if (items.length === 0) return null;
  const aspect = aspectRatio();
  const rects = squarify(items.map((item) => ({ key: item.ticker, value: item.value })), { x: 0, y: 0, w: aspect, h: 1 });
  const byTicker = new Map(items.map((item) => [item.ticker, item]));

  const cells = rects.map((rect) => {
    const item = byTicker.get(rect.key);
    const tone = returnTone(item.returnRate);
    const returnText = item.returnRate == null ? '손익 모름' : formatPercent(item.returnRate, { signed: true });
    const label = `${item.name}: 평가금액 ${money(item.value)}, 비중 ${formatPercentShort(item.weight)}, 수익률 ${returnText}`;
    return el('li', {
      class: 'heat-cell',
      style: `left: ${pct(rect.x / aspect)}; top: ${pct(rect.y)}; width: ${pct(rect.w / aspect)}; height: ${pct(rect.h)}`,
    }, el('button', {
      type: 'button',
      class: `heat-tile${tone.strength >= STRONG_TONE ? ' is-strong' : ''}`,
      style: tileBackground(tone),
      'aria-label': label,
      title: label,
      onClick: () => onSelect?.(item),
    },
    el('span', { class: 'heat-name', text: item.name }),
    el('span', { class: 'heat-return num', text: returnText }),
    el('span', { class: 'heat-value num', text: `${money(item.value)} · ${formatPercentShort(item.weight)}` })));
  });

  const limit = `${Math.round(FULL_TONE_RETURN * 100)}%`;
  return el('div', { class: 'heatmap-wrap' },
    el('ul', { class: 'heatmap', style: `aspect-ratio: ${aspect}`, 'aria-label': '보유 종목 히트맵 (칸 크기는 평가금액, 색은 수익률)' }, cells),
    el('div', { class: 'heat-legend' },
      el('span', { class: 'muted small', text: '칸 크기 = 평가금액 · 색 = 수익률' }),
      el('span', { class: 'heat-scale' },
        el('span', { class: 'small num', text: `-${limit}` }),
        el('span', { class: 'heat-scale-bar', 'aria-hidden': 'true' }),
        el('span', { class: 'small num', text: `+${limit}` }))));
}
