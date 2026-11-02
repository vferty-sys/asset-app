// 보유 종목 히트맵 — 미국 주식 지도(섹터별 히트맵)처럼 어두운 판 위에 칸을 그린다.
//  칸 크기 = 평가금액, 색 = 산 가격 대비 수익률 (0%는 어두운 회색, 이익 빨강·손실 파랑, 설정의 손익 색 바꾸기를 따름)
//  자산군·계좌별로 묶어 묶음 머리에 이름표를 달고, 칸 크기에 맞춰 글자 크기를 정한다.
//  칸 위치는 판의 실제 크기(픽셀)로 계산하고, 판 크기가 바뀌면(화면 회전·창 크기) 다시 계산한다.
//  PC에서는 칸에 마우스를 올리면 정보 창, 칸을 누르면 onSelect(item).

import {
  HEATMAP_GROUPINGS, heatColor, heatLegend, heatmapGroups, labelFit, layoutHeatmap, textWidthEm, tileLabel,
} from '../calc/treemap.js';
import { el, clear } from '../dom.js';
import { formatNumber, formatPercent, formatPercentShort } from '../format.js';
import { segmented } from './form.js';

const returnTextOf = (item) => (item.returnRate == null ? '–' : formatPercent(item.returnRate, { signed: true }));

// 계좌별 수량: '일반 300주 · ISA 100주'
const holdingsText = (item) => item.rows
  .map((row) => `${row.holding.account} ${formatNumber(row.holding.quantity, { maximumFractionDigits: 4 })}주`)
  .join(' · ');

// 칸 하나: 이름(또는 미국 티커) · 수익률 · (칸이 크면) 금액과 비중
function tileContent(item, w, h, money) {
  const label = tileLabel(item);
  const fit = labelFit(label, w, h);
  if (fit.size === 0) return [];
  const parts = [el('span', { class: `heat-name${fit.lines === 2 ? ' is-two' : ''}`, style: `font-size: ${fit.size}px`, text: label })];
  const nameHeight = fit.size * 1.12 * fit.lines;
  const room = w - Math.min(10, w * 0.08) * 2;
  // 수익률: 이름보다 조금 작게, 칸 폭을 넘지 않게
  const returnText = returnTextOf(item);
  const returnSize = Math.min(Math.max(9, Math.round(fit.size * 0.74)), Math.floor(room / textWidthEm(returnText)));
  if (returnSize >= 8 && h >= nameHeight + returnSize * 1.15 + 4) {
    parts.push(el('span', { class: 'heat-return', style: `font-size: ${returnSize}px`, text: returnText }));
    const valueText = `${money(item.value)} · ${formatPercentShort(item.weight)}`;
    if (h >= nameHeight + returnSize * 1.15 + 24 && room >= textWidthEm(valueText) * 11) {
      parts.push(el('span', { class: 'heat-value', text: valueText }));
    }
  }
  return parts;
}

// 마우스를 올렸을 때 보여 줄 정보 창 내용
function fillTip(tip, item, group, { money, color }) {
  clear(tip);
  const facts = [
    ['평가금액', money(item.value)],
    ['비중', formatPercent(item.weight)],
    ['평가손익', item.pnl == null ? '–' : money(item.pnl, { signed: true })],
    ['보유', holdingsText(item)],
  ];
  tip.append(
    el('div', { class: 'heat-tip-head' },
      el('div', {},
        el('p', { class: 'heat-tip-name', text: item.name }),
        el('p', { class: 'heat-tip-sub', text: [item.ticker, group.label].filter(Boolean).join(' · ') })),
      el('span', { class: 'heat-tip-return', style: `background: ${color}`, text: returnTextOf(item) })),
    el('dl', { class: 'heat-tip-facts' }, facts.map(([label, value]) => el('div', {},
      el('dt', { text: label }),
      el('dd', { text: value })))),
    el('p', { class: 'heat-tip-hint', text: '누르면 계좌별 내역과 수정' }));
}

// rows: valuePortfolio(...).rows, money: 금액 표시 함수, groupBy: 'assetClass' | 'account' | 'none'
export function holdingsHeatmap({ rows, money, groupBy = 'assetClass', invertColors = false, onGroupChange, onSelect }) {
  const groups = heatmapGroups(rows, groupBy);
  if (groups.length === 0) return null;
  const invert = Boolean(invertColors);

  const groupControl = segmented({ options: HEATMAP_GROUPINGS, value: groupBy, onChange: (next) => onGroupChange?.(next) });
  groupControl.element.classList.add('heat-groupby');
  groupControl.element.setAttribute('aria-label', '히트맵 묶는 방법');

  const map = el('div', { class: 'heatmap', role: 'group', 'aria-label': '보유 종목 히트맵. 칸 크기는 평가금액, 색은 수익률' });
  const tip = el('div', { class: 'heat-tip', hidden: true, 'aria-hidden': 'true' });
  const legend = el('ul', { class: 'heat-legend', 'aria-label': '색: 산 가격 대비 수익률' },
    heatLegend({ invert }).map((stop) => el('li', { style: `background: ${stop.color}`, text: stop.label })));
  const panel = el('section', { class: 'heatmap-panel', 'aria-label': '보유 종목 히트맵' },
    el('div', { class: 'heat-top' },
      el('h2', { class: 'heat-title', text: '보유 종목 지도' }),
      groupControl.element),
    map,
    el('div', { class: 'heat-bottom' },
      el('p', { class: 'heat-note', text: '칸 크기 = 평가금액 · 색 = 산 가격 대비 수익률' }),
      legend),
    tip);

  // 정보 창은 마우스를 따라다니고, 판 밖으로 나가지 않게 반대쪽으로 뒤집는다
  const placeTip = (event) => {
    const box = panel.getBoundingClientRect();
    const size = tip.getBoundingClientRect();
    let x = event.clientX - box.left + 16;
    let y = event.clientY - box.top + 16;
    if (x + size.width > box.width - 6) x = event.clientX - box.left - size.width - 16;
    if (y + size.height > box.height - 6) y = event.clientY - box.top - size.height - 16;
    tip.style.transform = `translate(${Math.round(Math.max(6, x))}px, ${Math.round(Math.max(6, y))}px)`;
  };
  const hideTip = () => { tip.hidden = true; };

  function tileElement(tile) {
    const { item, group } = tile;
    const color = heatColor(item.returnRate, { invert });
    const label = `${group.label ? `${group.label} · ` : ''}${item.name}: 평가금액 ${money(item.value)}, 비중 ${formatPercentShort(item.weight)}, 수익률 ${returnTextOf(item)}`;
    const button = el('button', {
      type: 'button',
      class: 'heat-tile',
      style: `background: ${color}`,
      'aria-label': label,
      onClick: () => {
        hideTip();
        onSelect?.(item);
      },
    }, tileContent(item, tile.w, tile.h, money));
    button.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'mouse') return;
      fillTip(tip, item, group, { money, color });
      tip.hidden = false;
      placeTip(event);
    });
    button.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'mouse' && !tip.hidden) placeTip(event);
    });
    button.addEventListener('pointerleave', hideTip);
    return el('li', { style: `left: ${tile.x}px; top: ${tile.y}px; width: ${tile.w}px; height: ${tile.h}px` }, button);
  }

  let drawnSize = '';
  function draw(width, height) {
    const size = `${Math.round(width)}x${Math.round(height)}`;
    if (size === drawnSize) return;
    drawnSize = size;
    hideTip();
    const layout = layoutHeatmap(groups, { width: Math.round(width), height: Math.round(height), headers: groupBy !== 'none' });
    clear(map);
    for (const group of layout.groups) {
      if (!group.header) continue;
      // 이름표가 묶음 폭에 다 들어가면 '이름 비중', 비중까지는 안 되면 이름만, 이름도 안 되면 비워 둔다
      const weightText = formatPercentShort(group.weight);
      const room = group.w - 8;
      const nameWidth = textWidthEm(group.label) * 11 * 1.06;
      if (nameWidth > room) continue;
      const withWeight = nameWidth + 6 + textWidthEm(weightText) * 11 <= room;
      map.append(el('div', {
        class: 'heat-group-label',
        'aria-hidden': 'true',
        style: `left: ${group.x}px; top: ${group.y}px; width: ${group.w}px`,
      }, el('span', { class: 'heat-group-name', text: group.label }), withWeight ? el('span', { class: 'heat-group-weight', text: weightText }) : null));
    }
    map.append(el('ul', { class: 'heat-tiles' }, layout.tiles.map(tileElement)));
  }

  // 판이 화면에 붙어 크기가 정해지면 그리고, 크기가 바뀌면 다시 그린다. 화면에서 떨어지면 그만 본다.
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver((entries) => {
      if (!map.isConnected) {
        observer.disconnect();
        return;
      }
      const { width, height } = entries[entries.length - 1].contentRect;
      if (width > 0 && height > 0) draw(width, height);
    });
    observer.observe(map);
  }
  return panel;
}
