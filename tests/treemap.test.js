import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FULL_TONE_RETURN, heatmapItems, returnTone, squarify } from '../js/calc/treemap.js';
import { valuePortfolio } from '../js/calc/valuation.js';

const near = (actual, expected, message, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${message ?? ''} ${actual} ≠ ${expected}`);

function overlaps(a, b) {
  const eps = 1e-9;
  return a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps;
}

test('squarify: 넓이가 값에 비례하고, 사각형 안을 겹치지 않게 빈틈없이 채운다', () => {
  const values = [6, 6, 4, 3, 2, 2, 1];
  const rect = { x: 0, y: 0, w: 6, h: 4 };
  const rects = squarify(values.map((value, index) => ({ key: `k${index}`, value })), rect);
  assert.equal(rects.length, values.length);
  const total = values.reduce((a, b) => a + b, 0);
  for (const r of rects) {
    const value = values[Number(r.key.slice(1))];
    near(r.w * r.h, (value / total) * 24, r.key);
    assert.ok(r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= 6 + 1e-9 && r.y + r.h <= 4 + 1e-9, `${r.key} 사각형 안`);
  }
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) assert.ok(!overlaps(rects[i], rects[j]), `${rects[i].key}·${rects[j].key} 겹침`);
  }
  near(rects.reduce((s, r) => s + r.w * r.h, 0), 24);
});

test('squarify: 논문 예시(6,6,4,3,2,2,1 / 6×4)처럼 칸이 정사각형에 가깝다', () => {
  const rects = squarify([6, 6, 4, 3, 2, 2, 1].map((value, index) => ({ key: index, value })), { x: 0, y: 0, w: 6, h: 4 });
  const worst = Math.max(...rects.map((r) => Math.max(r.w / r.h, r.h / r.w)));
  assert.ok(worst < 3, `가장 길쭉한 칸 ${worst}`);
  // 큰 두 칸은 왼쪽에 3×2로 나란히
  near(rects[0].w, 3);
  near(rects[0].h, 2);
});

test('squarify: 값이 하나면 전체, 0 이하·숫자가 아닌 값은 빼고, 비어 있으면 빈 목록', () => {
  assert.deepEqual(squarify([{ key: 'a', value: 5 }], { x: 0, y: 0, w: 2, h: 1 }), [{ key: 'a', x: 0, y: 0, w: 2, h: 1 }]);
  const rects = squarify([{ key: 'a', value: 1 }, { key: 'b', value: 0 }, { key: 'c', value: -3 }, { key: 'd', value: NaN }]);
  assert.deepEqual(rects.map((r) => r.key), ['a']);
  assert.deepEqual(squarify([]), []);
  assert.deepEqual(squarify([{ key: 'a', value: 1 }], { x: 0, y: 0, w: 0, h: 1 }), []);
});

test('squarify: 아주 작은 값이 섞여도 멈추지 않고 모든 칸을 만든다', () => {
  const items = [1000, 500, 0.001, 0.0001, 300, 1e-7].map((value, index) => ({ key: index, value }));
  const rects = squarify(items, { x: 0, y: 0, w: 1, h: 1 });
  assert.equal(rects.length, 6);
  near(rects.reduce((s, r) => s + r.w * r.h, 0), 1, '', 1e-9);
});

function holding(id, { price, avgPrice = price, quantity = 10, account = '일반', ticker = `KRX:${id}`, currency = 'KRW' } = {}) {
  return { id, name: id, ticker, type: 'etf', currency, quantity, avgPrice, manualPrice: price, account, assetClass: '성장주', countryMix: { 한국: 100 }, sectorMix: { 기술: 100 } };
}

test('heatmapItems: 같은 티커는 한 칸으로 묶고 손익·수익률·비중을 다시 계산한다', () => {
  const rows = valuePortfolio([
    holding('A', { price: 12_000, avgPrice: 10_000 }),
    holding('A2', { ticker: 'KRX:A', price: 12_000, avgPrice: 8_000, account: 'ISA' }),
    holding('B', { price: 9_000, avgPrice: 10_000, quantity: 20 }),
    holding('ZERO', { price: 5_000, quantity: 0 }),
  ]).rows;
  const items = heatmapItems(rows);
  assert.deepEqual(items.map((item) => item.ticker), ['KRX:A', 'KRX:B']);
  const [a, b] = items;
  assert.equal(a.value, 240_000);
  assert.equal(a.cost, 180_000);
  assert.equal(a.pnl, 60_000);
  near(a.returnRate, 1 / 3);
  near(a.weight, 240_000 / 420_000);
  assert.equal(a.rows.length, 2);
  near(b.returnRate, -0.1);
});

test('heatmapItems: 환율이 없어 금액을 모르는 종목은 뺀다', () => {
  const rows = valuePortfolio([holding('A', { price: 10_000 }), holding('US', { ticker: 'NASDAQ:US', price: 100, currency: 'USD' })], { fxRate: null }).rows;
  assert.deepEqual(heatmapItems(rows).map((item) => item.ticker), ['KRX:A']);
  assert.deepEqual(heatmapItems([]), []);
});

test('returnTone: 이익·손실 방향과 진하기 (0.15부터, 기준 이상이면 1)', () => {
  assert.deepEqual(returnTone(null), { tone: 'flat', strength: 0 });
  assert.deepEqual(returnTone(0), { tone: 'flat', strength: 0 });
  assert.deepEqual(returnTone(0.0001), { tone: 'flat', strength: 0 });
  assert.deepEqual(returnTone(FULL_TONE_RETURN), { tone: 'gain', strength: 1 });
  assert.deepEqual(returnTone(-0.9), { tone: 'loss', strength: 1 });
  const small = returnTone(0.01);
  assert.equal(small.tone, 'gain');
  assert.ok(small.strength > 0.15 && small.strength < 0.25, String(small.strength));
  assert.ok(returnTone(-0.1).strength < returnTone(-0.2).strength);
});
