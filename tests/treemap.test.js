import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HEAT_NEUTRAL, heatColor, heatLegend, heatmapGroups, heatmapItems, labelFit, layoutHeatmap, squarify, textWidthEm, tileLabel,
} from '../js/calc/treemap.js';
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

test('heatmapGroups: 자산군·계좌별로 묶고, 큰 묶음부터, 비중은 전체 기준', () => {
  const rows = valuePortfolio([
    holding('A', { price: 12_000, avgPrice: 10_000 }),
    holding('A2', { ticker: 'KRX:A', price: 12_000, avgPrice: 8_000, account: 'ISA' }),
    { ...holding('BOND', { price: 10_000, quantity: 5 }), assetClass: '채권' },
    holding('ZERO', { price: 5_000, quantity: 0 }),
  ]).rows;
  const byClass = heatmapGroups(rows, 'assetClass');
  assert.deepEqual(byClass.map((group) => [group.key, group.label, group.value]), [['성장주', '성장주', 240_000], ['채권', '채권', 50_000]]);
  near(byClass[0].weight, 240_000 / 290_000);
  near(byClass[1].items[0].weight, 50_000 / 290_000, '칸 비중은 전체 기준');
  assert.equal(byClass[0].items.length, 1, '같은 티커는 한 칸');

  const byAccount = heatmapGroups(rows, 'account');
  assert.deepEqual(byAccount.map((group) => group.label), ['일반 계좌', 'ISA 계좌']);
  assert.equal(byAccount[0].items.length, 2, '일반 계좌: A와 BOND');
  assert.equal(byAccount[1].items[0].rows.length, 1, '계좌별이면 계좌마다 따로');

  const none = heatmapGroups(rows, 'none');
  assert.equal(none.length, 1);
  assert.equal(none[0].label, '');
  assert.deepEqual(heatmapGroups([], 'assetClass'), []);
});

function overlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

test('layoutHeatmap: 정수 픽셀 칸이 화면 안에 겹치지 않게, 묶음 사이·칸 사이에 선 자리를 남긴다', () => {
  const rows = valuePortfolio([
    holding('A', { price: 30_000 }), holding('B', { price: 20_000 }), holding('C', { price: 9_000 }),
    { ...holding('D', { price: 25_000 }), assetClass: '채권' }, { ...holding('E', { price: 6_000 }), assetClass: '채권' },
  ]).rows;
  const groups = heatmapGroups(rows, 'assetClass');
  const layout = layoutHeatmap(groups, { width: 600, height: 400 });
  assert.equal(layout.groups.length, 2);
  assert.equal(layout.tiles.length, 5);
  for (const tile of [...layout.groups, ...layout.tiles]) {
    assert.ok(Number.isInteger(tile.x) && Number.isInteger(tile.y) && Number.isInteger(tile.w) && Number.isInteger(tile.h), '정수 픽셀');
    assert.ok(tile.x >= 3 && tile.y >= 3 && tile.x + tile.w <= 597 && tile.y + tile.h <= 397, `테두리 3px 안 ${JSON.stringify([tile.x, tile.y, tile.w, tile.h])}`);
  }
  for (let i = 0; i < layout.tiles.length; i += 1) {
    for (let j = i + 1; j < layout.tiles.length; j += 1) assert.ok(!overlap(layout.tiles[i], layout.tiles[j]), '칸이 겹침');
  }
  // 묶음 이름표 자리: 칸은 묶음 머리 18px 아래부터
  for (const tile of layout.tiles) {
    assert.ok(tile.group.header);
    assert.ok(tile.y >= tile.group.y + 18 && tile.x >= tile.group.x && tile.x + tile.w <= tile.group.x + tile.group.w);
  }
  // 칸 넓이는 금액 순서
  const areaOf = (ticker) => layout.tiles.filter((tile) => tile.item.ticker === ticker).reduce((s, t) => s + t.w * t.h, 0);
  assert.ok(areaOf('KRX:A') > areaOf('KRX:B') && areaOf('KRX:B') > areaOf('KRX:C'));
});

test('layoutHeatmap: 묶지 않으면 이름표도 바깥 테두리도 없고, 작은 묶음은 이름표를 뺀다', () => {
  const rows = valuePortfolio([holding('A', { price: 30_000 }), holding('B', { price: 10_000 })]).rows;
  const flat = layoutHeatmap(heatmapGroups(rows, 'none'), { width: 300, height: 200, headers: false });
  assert.equal(flat.groups[0].header, false);
  assert.equal(Math.min(...flat.tiles.map((tile) => tile.x)), 0);
  assert.equal(Math.max(...flat.tiles.map((tile) => tile.x + tile.w)), 300);
  const tiny = layoutHeatmap(heatmapGroups(rows, 'assetClass'), { width: 50, height: 30 });
  assert.equal(tiny.groups[0].header, false);
  assert.deepEqual(layoutHeatmap([], { width: 300, height: 200 }), { groups: [], tiles: [] });
  assert.deepEqual(layoutHeatmap(heatmapGroups(rows), { width: 0, height: 200 }), { groups: [], tiles: [] });
});

test('heatColor: 0%는 어두운 회색, 멀수록 진하게, 30%부터 가장 진함, 설정에 따라 이익·손실 색을 바꾼다', () => {
  assert.equal(heatColor(null), HEAT_NEUTRAL);
  assert.equal(heatColor(0), HEAT_NEUTRAL);
  assert.equal(heatColor(0.05), '#8b444e');
  assert.equal(heatColor(0.3), '#f63538');
  assert.equal(heatColor(0.9), '#f63538');
  assert.equal(heatColor(-0.15), '#3568b8');
  assert.equal(heatColor(-0.5), '#2f7ff0');
  assert.equal(heatColor(0.3, { invert: true }), '#2f7ff0', '반전: 이익 파랑');
  assert.equal(heatColor(-0.3, { invert: true }), '#f63538', '반전: 손실 빨강');
  // 중간값은 두 색 사이
  const mid = heatColor(0.1);
  assert.match(mid, /^#[0-9a-f]{6}$/);
  assert.notEqual(mid, '#8b444e');
  assert.notEqual(mid, '#bf4045');
  const red = (hex) => parseInt(hex.slice(1, 3), 16);
  assert.ok(red(heatColor(0.02)) < red(heatColor(0.04)) && red(heatColor(0.04)) < red(heatColor(0.1)));
});

test('heatLegend: -30% ~ +30% 일곱 칸', () => {
  const legend = heatLegend();
  assert.deepEqual(legend.map((item) => item.label), ['-30%', '-15%', '-5%', '0%', '+5%', '+15%', '+30%']);
  assert.equal(legend[3].color, HEAT_NEUTRAL);
  assert.equal(legend[6].color, '#f63538');
  assert.equal(heatLegend({ invert: true })[6].color, '#2f7ff0');
});

test('tileLabel: 미국 거래소 종목은 티커, 국내 종목은 이름', () => {
  assert.equal(tileLabel({ ticker: 'NYSEARCA:VOO', name: 'Vanguard S&P 500 ETF' }), 'VOO');
  assert.equal(tileLabel({ ticker: 'NASDAQ:AAPL', name: 'Apple' }), 'AAPL');
  assert.equal(tileLabel({ ticker: 'KRX:360750', name: 'TIGER 미국S&P500' }), 'TIGER 미국S&P500');
  assert.equal(tileLabel({ ticker: 'VOO', name: 'Vanguard' }), 'Vanguard');
});

test('labelFit: 큰 칸은 크게(최대 34px), 긴 이름은 두 줄, 아주 작은 칸은 글자 없이', () => {
  assert.ok(textWidthEm('삼성전자') > textWidthEm('VOO'));
  assert.deepEqual(labelFit('VOO', 400, 300), { size: 34, lines: 1 });
  const wide = labelFit('TIGER 미국S&P500', 330, 190);
  assert.equal(wide.lines, 1);
  assert.ok(wide.size >= 28 && wide.size <= 34, String(wide.size));
  const tall = labelFit('TIGER 미국배당다우존스', 150, 140);
  assert.equal(tall.lines, 2);
  assert.ok(tall.size > labelFit('TIGER 미국배당다우존스', 150, 40).size);
  assert.deepEqual(labelFit('삼성전자', 140, 100).lines, 1, '띄어쓰기가 없으면 한 줄');
  assert.deepEqual(labelFit('KODEX 국고채3년', 40, 22), { size: 9, lines: 1 }, '작아도 앞부분은');
  assert.deepEqual(labelFit('KODEX 국고채3년', 20, 12), { size: 0, lines: 0 });
});
