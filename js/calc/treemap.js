// 보유 종목 히트맵: 칸 크기 = 평가금액, 색 = 수익률.
//  squarify: 금액에 비례하는 넓이로 사각형을 나눈다 (가능한 한 정사각형에 가깝게, Bruls·Huizing·van Wijk 2000).
//  heatmapItems: 같은 티커를 여러 계좌에 나눠 가져도 한 칸으로 묶는다.
//  returnTone: 수익률을 색의 방향(이익·손실)과 진하기(0~1)로 바꾼다.

const sum = (values) => values.reduce((total, value) => total + value, 0);

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

// valuePortfolio(...).rows → 히트맵 칸 (평가금액이 있는 종목만, 큰 순서)
//  { ticker, name, value, cost, pnl, returnRate, weight, rows }
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

// 이 수익률(±)부터 가장 진한 색
export const FULL_TONE_RETURN = 0.25;

// 수익률 → { tone: 'gain' | 'loss' | 'flat', strength: 0~1 }. 조금만 달라도 옅게라도 색이 보이게 0.15부터 시작한다.
export function returnTone(returnRate) {
  if (!Number.isFinite(returnRate) || Math.abs(returnRate) < 0.0005) return { tone: 'flat', strength: 0 };
  const ratio = Math.min(1, Math.abs(returnRate) / FULL_TONE_RETURN);
  return { tone: returnRate > 0 ? 'gain' : 'loss', strength: Math.round((0.15 + 0.85 * ratio) * 100) / 100 };
}
