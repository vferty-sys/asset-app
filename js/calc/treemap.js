// 보유 종목 히트맵 (미국 주식 지도처럼): 칸 크기 = 평가금액, 색 = 수익률, 자산군·계좌별로 묶음
//  squarify: 금액에 비례하는 넓이로 사각형을 나눈다 (가능한 한 정사각형에 가깝게, Bruls·Huizing·van Wijk 2000).
//  heatmapItems / heatmapGroups: 같은 티커는 한 칸으로, 칸들은 자산군·계좌별 묶음으로.
//  layoutHeatmap: 묶음 → 칸을 화면 픽셀 위치로 (묶음 사이 굵은 선, 칸 사이 가는 선, 묶음 이름표 자리).
//  heatColor: 수익률 → 칸 색 (0%는 어두운 회색, 멀어질수록 진한 빨강·파랑).
//  labelFit: 칸 크기에 맞는 글자 크기 (큰 칸은 크게, 긴 이름은 두 줄로).

const sum = (values) => values.reduce((total, value) => total + value, 0);

// ── 칸 나누기 ──

// row(넓이 목록)를 길이 side인 변에 붙여 놓을 때 가장 길쭉한 칸의 비율 (1이면 정사각형)
function worstRatio(row, side) {
  const total = sum(row);
  if (total <= 0 || side <= 0) return Infinity;
  const largest = Math.max(...row);
  const smallest = Math.min(...row);
  const sideSq = side * side;
  const totalSq = total * total;
  return Math.max((sideSq * largest) / totalSq, totalSq / (sideSq * smallest));
}

// row를 rect의 짧은 변 쪽에 한 줄로 붙이고, 남은 사각형을 돌려준다.
function placeRow(row, rect, out) {
  const total = sum(row.map((item) => item.area));
  if (rect.w >= rect.h) {
    // 왼쪽에 세로 한 줄
    const width = rect.h > 0 ? total / rect.h : 0;
    let y = rect.y;
    for (const item of row) {
      const height = width > 0 ? item.area / width : 0;
      out.push({ key: item.key, x: rect.x, y, w: width, h: height });
      y += height;
    }
    return { x: rect.x + width, y: rect.y, w: rect.w - width, h: rect.h };
  }
  // 위쪽에 가로 한 줄
  const height = rect.w > 0 ? total / rect.w : 0;
  let x = rect.x;
  for (const item of row) {
    const width = height > 0 ? item.area / height : 0;
    out.push({ key: item.key, x, y: rect.y, w: width, h: height });
    x += width;
  }
  return { x: rect.x, y: rect.y + height, w: rect.w, h: rect.h - height };
}

// items: [{ key, value }] → [{ key, x, y, w, h }] (rect 안, 큰 값부터). 값이 0 이하인 항목은 뺀다.
export function squarify(items, rect = { x: 0, y: 0, w: 1, h: 1 }) {
  const positive = (items ?? []).filter((item) => Number.isFinite(item.value) && item.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = sum(positive.map((item) => item.value));
  if (total <= 0 || !(rect.w > 0) || !(rect.h > 0)) return [];
  const scale = (rect.w * rect.h) / total;
  const queue = positive.map((item) => ({ key: item.key, area: item.value * scale }));
  const out = [];
  let remaining = { ...rect };
  let row = [];
  while (queue.length > 0) {
    const next = queue[0];
    const side = Math.min(remaining.w, remaining.h);
    const areas = row.map((item) => item.area);
    if (row.length === 0 || worstRatio([...areas, next.area], side) <= worstRatio(areas, side)) {
      row.push(queue.shift());
    } else {
      remaining = placeRow(row, remaining, out);
      row = [];
    }
  }
  if (row.length > 0) placeRow(row, remaining, out);
  return out;
}

// ── 칸에 들어갈 종목 ──

// valuePortfolio(...).rows → 히트맵 칸 (평가금액이 있는 종목만, 큰 순서). 같은 티커는 한 칸으로 묶는다.
//  { ticker, name, value, cost, pnl, returnRate, weight, rows }  (weight는 넘긴 rows 안에서의 비중)
export function heatmapItems(rows) {
  const map = new Map();
  for (const row of rows ?? []) {
    if (!(row.valueKRW > 0)) continue;
    const { ticker } = row.holding;
    const item = map.get(ticker) ?? { ticker, name: row.holding.name, value: 0, cost: 0, costKnown: true, rows: [] };
    item.value += row.valueKRW;
    if (row.costKRW == null) item.costKnown = false;
    else item.cost += row.costKRW;
    item.rows.push(row);
    map.set(ticker, item);
  }
  const items = [...map.values()];
  const total = sum(items.map((item) => item.value));
  return items
    .map(({ costKnown, ...item }) => {
      const pnl = costKnown ? item.value - item.cost : null;
      return {
        ...item,
        pnl,
        returnRate: pnl != null && item.cost > 0 ? pnl / item.cost : null,
        weight: total > 0 ? item.value / total : 0,
      };
    })
    .sort((a, b) => b.value - a.value);
}

// 묶는 방법: 자산군(미국 지도의 섹터처럼) / 계좌 / 묶지 않기
export const HEATMAP_GROUPINGS = Object.freeze([['assetClass', '자산군'], ['account', '계좌'], ['none', '묶지 않기']]);

// rows → [{ key, label, value, weight, items }] (큰 묶음부터). 칸의 weight는 전체에서의 비중.
export function heatmapGroups(rows, groupBy = 'assetClass') {
  const keyOf = (holding) => {
    if (groupBy === 'account') return holding.account || '기타';
    if (groupBy === 'none') return 'all';
    return holding.assetClass || '기타';
  };
  const buckets = new Map();
  for (const row of rows ?? []) {
    if (!(row.valueKRW > 0)) continue;
    const key = keyOf(row.holding);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }
  const groups = [...buckets.entries()].map(([key, groupRows]) => {
    const items = heatmapItems(groupRows);
    return { key, label: groupBy === 'none' ? '' : groupBy === 'account' ? `${key} 계좌` : key, value: sum(items.map((item) => item.value)), items };
  });
  const total = sum(groups.map((group) => group.value));
  for (const group of groups) {
    group.weight = total > 0 ? group.value / total : 0;
    for (const item of group.items) item.weight = total > 0 ? item.value / total : 0;
  }
  return groups.sort((a, b) => b.value - a.value);
}

// ── 화면 배치 (픽셀) ──

// 묶음 사이 굵은 선(groupGap), 칸 사이 가는 선(tileGap), 묶음 머리의 이름표 자리(headerHeight).
// 바깥 테두리도 groupGap만큼 띄운다. 위치는 정수 픽셀로 맞춰 선이 또렷하게 보이게 한다.
//  돌려주는 값: { groups: [{ key, label, weight, x, y, w, h, header }], tiles: [{ item, group, x, y, w, h }] }
export function layoutHeatmap(groups, {
  width, height, headers = true, groupGap = 3, tileGap = 1, headerHeight = 18,
} = {}) {
  const out = { groups: [], tiles: [] };
  if (!(width > 0) || !(height > 0)) return out;
  const gap = groups.length > 1 || headers ? groupGap : 0;
  const byKey = new Map(groups.map((group) => [group.key, group]));
  const groupRects = squarify(groups.map((group) => ({ key: group.key, value: group.value })), { x: 0, y: 0, w: width - gap, h: height - gap });
  for (const rect of groupRects) {
    const group = byKey.get(rect.key);
    const x0 = Math.round(rect.x) + gap;
    const y0 = Math.round(rect.y) + gap;
    const x1 = Math.round(rect.x + rect.w);
    const y1 = Math.round(rect.y + rect.h);
    if (x1 - x0 <= 0 || y1 - y0 <= 0) continue;
    // 이름표는 묶음이 이름을 쓸 만큼 클 때만 (작은 묶음은 칸만)
    const header = headers && x1 - x0 >= 56 && y1 - y0 >= headerHeight + 24;
    const placed = { key: group.key, label: group.label, weight: group.weight, x: x0, y: y0, w: x1 - x0, h: y1 - y0, header };
    out.groups.push(placed);
    const top = header ? y0 + headerHeight : y0;
    const tileRects = squarify(group.items.map((item, index) => ({ key: index, value: item.value })), {
      x: x0 - tileGap, y: top - tileGap, w: x1 - x0 + tileGap, h: y1 - top + tileGap,
    });
    for (const tile of tileRects) {
      const tx0 = Math.round(tile.x) + tileGap;
      const ty0 = Math.round(tile.y) + tileGap;
      const tx1 = Math.round(tile.x + tile.w);
      const ty1 = Math.round(tile.y + tile.h);
      if (tx1 - tx0 <= 0 || ty1 - ty0 <= 0) continue;
      out.tiles.push({ item: group.items[tile.key], group: placed, x: tx0, y: ty0, w: tx1 - tx0, h: ty1 - ty0 });
    }
  }
  return out;
}

// ── 색 ──

// 수익률이 0이면 어두운 회색, 5% → 15% → 30%로 갈수록 진해진다 (30% 넘으면 가장 진함).
// 이익은 빨강, 손실은 파랑 (설정에서 손익 색을 바꾸면 반대로).
export const HEAT_STOPS = Object.freeze([0.05, 0.15, 0.3]);
export const HEAT_NEUTRAL = '#414554';
const HEAT_RED = ['#8b444e', '#bf4045', '#f63538'];
const HEAT_BLUE = ['#3e5a87', '#3568b8', '#2f7ff0'];

const toRgb = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
const toHex = (rgb) => `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
const mixHex = (from, to, t) => {
  const a = toRgb(from);
  const b = toRgb(to);
  return toHex(a.map((value, index) => value + (b[index] - value) * t));
};

export function heatColor(returnRate, { invert = false } = {}) {
  if (!Number.isFinite(returnRate) || returnRate === 0) return HEAT_NEUTRAL;
  const gain = returnRate > 0;
  const colors = [HEAT_NEUTRAL, ...(gain !== invert ? HEAT_RED : HEAT_BLUE)];
  const stops = [0, ...HEAT_STOPS];
  const size = Math.abs(returnRate);
  if (size >= stops[stops.length - 1]) return colors[colors.length - 1];
  const index = stops.findIndex((stop, i) => size >= stop && size < stops[i + 1]);
  const t = (size - stops[index]) / (stops[index + 1] - stops[index]);
  return mixHex(colors[index], colors[index + 1], t);
}

// 범례 칸: -30% … 0% … +30%
export function heatLegend({ invert = false } = {}) {
  const values = [...HEAT_STOPS].reverse().map((stop) => -stop).concat([0], HEAT_STOPS);
  return values.map((value) => ({
    value,
    label: `${value > 0 ? '+' : ''}${Math.round(value * 100)}%`,
    color: heatColor(value, { invert }),
  }));
}

// ── 글자 ──

// 미국 거래소 종목은 지도처럼 티커(VOO, AAPL)를, 국내 종목은 이름을 칸에 쓴다.
const US_EXCHANGE = /^(NYSE|NASDAQ|NYSEARCA|NYSEAMERICAN|AMEX|BATS|CBOE)(?::|$)/i;
export function tileLabel(item) {
  const [exchange, symbol] = String(item.ticker ?? '').split(':');
  return symbol && US_EXCHANGE.test(exchange) ? symbol : item.name;
}

// 글자 폭 어림 (글자 크기 1 기준): 한글 ≈ 1, 영문 대문자·숫자 ≈ 0.62, 소문자 ≈ 0.55, 띄어쓰기 ≈ 0.28
export function textWidthEm(text) {
  let width = 0;
  for (const char of String(text ?? '')) {
    if (/[가-힣ㄱ-ㆎ一-鿿]/.test(char)) width += 0.98;
    else if (char === ' ') width += 0.28;
    else if (/[.,·:]/.test(char)) width += 0.3;
    else if (/[A-Z0-9%&+\-]/.test(char)) width += 0.64;
    else width += 0.56;
  }
  return width;
}

// 두 줄로 나눌 때 더 긴 줄의 폭 (띄어쓰기에서만 나눈다). 나눌 곳이 없으면 null.
function twoLineWidthEm(text) {
  const words = String(text ?? '').split(' ').filter(Boolean);
  if (words.length < 2) return null;
  let best = Infinity;
  for (let i = 1; i < words.length; i += 1) {
    best = Math.min(best, Math.max(textWidthEm(words.slice(0, i).join(' ')), textWidthEm(words.slice(i).join(' '))));
  }
  return best;
}

// 칸(w×h 픽셀)에 이름을 쓸 글자 크기. { size, lines } — 너무 작으면 { size: 0, lines: 0 } (글자 없이 색만)
export function labelFit(text, w, h, { min = 9, max = 34 } = {}) {
  const pad = Math.min(10, w * 0.08);
  const room = w - pad * 2;
  const bold = 1.06;
  const one = Math.min(max, room / (textWidthEm(text) * bold), h * 0.3);
  let size = one;
  let lines = 1;
  // 두 줄로 나누면 글자가 꽤(1.25배 넘게) 커질 때만 두 줄
  const twoWidth = twoLineWidthEm(text);
  if (twoWidth) {
    const two = Math.min(max, room / (twoWidth * bold), h * 0.2);
    if (two > one * 1.25) {
      size = two;
      lines = 2;
    }
  }
  size = Math.floor(size);
  if (size >= min) return { size, lines };
  // 이름이 길어 다 못 써도 칸이 어느 정도 크면 가장 작은 글자로 앞부분만 (뒤는 …)
  if (w >= 34 && h >= 20) return { size: min, lines: 1 };
  return { size: 0, lines: 0 };
}
