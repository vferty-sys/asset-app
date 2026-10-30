import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChartData } from '../js/charts.js';
import { toBreakdown } from '../js/calc/diversification.js';
import { ASSET_CLASSES, COUNTRY_OPTIONS, DEPOSIT_ASSET_CLASS, PENSION_ASSET_CLASS, SECTOR_OPTIONS } from '../js/constants.js';

const pairs = (list) => list.map((item) => [item.name, item.color]);

test('색은 정해진 순서대로, 기타는 회색, 미분류는 옅은 회색', () => {
  const breakdown = toBreakdown([['미국', 50], ['한국', 30], ['기타', 10], ['미분류', 10]]);
  const { rows, slices } = buildChartData(breakdown, { order: COUNTRY_OPTIONS });
  assert.deepEqual(pairs(rows), [['한국', 'series-1'], ['미국', 'series-2'], ['기타', 'series-other'], ['미분류', 'series-unclassified']]);
  assert.deepEqual(pairs(slices), pairs(rows));
});

test('항목이 뒤에 더해져도 앞 항목의 색은 그대로 (주식만 → 전체 보기)', () => {
  const order = [...ASSET_CLASSES, DEPOSIT_ASSET_CLASS, PENSION_ASSET_CLASS];
  const stocks = buildChartData(toBreakdown([['성장주', 70], ['배당주', 30]]), { order });
  const all = buildChartData(toBreakdown([['성장주', 70], ['배당주', 30], [DEPOSIT_ASSET_CLASS, 500], [PENSION_ASSET_CLASS, 300]]), { order });
  assert.deepEqual(pairs(stocks.rows), [['성장주', 'series-1'], ['배당주', 'series-2']]);
  assert.deepEqual(pairs(all.rows), [['성장주', 'series-1'], ['배당주', 'series-2'], [DEPOSIT_ASSET_CLASS, 'series-3'], [PENSION_ASSET_CLASS, 'series-4']]);
});

test('색 있는 항목은 6개까지: 작은 항목은 차트에서 "그 외"로 묶고, 목록에는 모두 남긴다', () => {
  const sectors = [['기술', 30], ['통신', 15], ['소비재', 12], ['금융', 11], ['헬스케어', 10], ['산업재', 9], ['에너지', 5], ['소재', 3], ['기타', 5]];
  const { rows, slices } = buildChartData(toBreakdown(sectors), { order: SECTOR_OPTIONS });
  assert.equal(rows.length, 9);
  // 큰 6개를 남기고, 색은 섹터 목록 순서(기술·통신·소비재·필수소비재·헬스케어·금융·산업재 …)대로
  assert.deepEqual(rows.filter((row) => row.color.startsWith('series-') && row.color !== 'series-other').map((row) => row.name),
    ['기술', '통신', '소비재', '헬스케어', '금융', '산업재']);
  assert.deepEqual(pairs(rows.slice(6)), [['기타', 'series-other'], ['에너지', 'series-other'], ['소재', 'series-other']]);
  const rest = slices[slices.length - 1];
  assert.equal(slices.length, 7);
  assert.equal(rest.name, '기타·그 외');
  assert.equal(rest.value, 13);
});

test('목록에 없는 이름(CSV로 들어온 국가 등)은 정해진 항목 뒤에 색을 받는다', () => {
  const { rows } = buildChartData(toBreakdown([['베트남', 40], ['미국', 60]]), { order: COUNTRY_OPTIONS });
  assert.deepEqual(pairs(rows), [['미국', 'series-1'], ['베트남', 'series-2']]);
});

test('빈 집계', () => {
  assert.deepEqual(buildChartData([], { order: COUNTRY_OPTIONS }), { rows: [], slices: [] });
});
