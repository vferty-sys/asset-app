import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFx, resolvePrice, toKRW, valueHolding, valuePortfolio } from '../js/calc/valuation.js';

const krw = (overrides = {}) => ({
  id: 'k', ticker: 'KRX:005930', currency: 'KRW', quantity: 10, avgPrice: 60000, manualPrice: 70000, dividendPerShare: null, ...overrides,
});
const usd = (overrides = {}) => ({
  id: 'u', ticker: 'NASDAQ:QQQ', currency: 'USD', quantity: 2, avgPrice: 400, manualPrice: 500, dividendPerShare: null, ...overrides,
});

test('원화 평가금액 = 수량 × 현재가 (원화 종목)', () => {
  const row = valueHolding(krw(), {});
  assert.equal(row.valueKRW, 700000);
  assert.equal(row.costKRW, 600000);
  assert.equal(row.pnlKRW, 100000);
  assert.ok(Math.abs(row.returnRate - 1 / 6) < 1e-12);
});

test('원화 평가금액 = 수량 × 현재가 × 환율 (달러 종목)', () => {
  const row = valueHolding(usd(), { fxRate: 1400 });
  assert.equal(row.valueKRW, 2 * 500 * 1400);
  assert.equal(row.costKRW, 2 * 400 * 1400);
  assert.equal(row.missingFx, false);
});

test('가격 우선순위: 시트 가격 → 직접 입력한 현재가 → 평단가', () => {
  const prices = { 'KRX:005930': { price: 72000, currency: 'KRW' } };
  assert.deepEqual(resolvePrice(krw(), prices), { price: 72000, source: 'sheet' });
  assert.deepEqual(resolvePrice(krw(), {}), { price: 70000, source: 'manual' });
  assert.deepEqual(resolvePrice(krw({ manualPrice: null }), {}), { price: 60000, source: 'avg' });
});

test('시트 가격이 0이거나 이상하면 다음 순위 가격을 쓴다', () => {
  for (const price of [0, -1, NaN, null, '72000']) {
    const prices = { 'KRX:005930': { price } };
    assert.equal(resolvePrice(krw(), prices).source, 'manual', String(price));
  }
});

test('현재가도 평단가도 없으면 가격 없음', () => {
  const row = valueHolding(krw({ manualPrice: null, avgPrice: null }), {});
  assert.equal(row.priceSource, 'none');
  assert.equal(row.valueKRW, null);
});

test('환율이 없으면 달러 종목은 원화로 바꿀 수 없다 (null)', () => {
  const row = valueHolding(usd(), { fxRate: null });
  assert.equal(row.valueKRW, null);
  assert.equal(row.pnlKRW, null);
  assert.equal(row.missingFx, true);
  assert.equal(toKRW(100, 'USD', 0), null);
  assert.equal(toKRW(100, 'KRW', null), 100);
});

test('환율 우선순위: 시트 → 직접 입력 → 없음', () => {
  assert.deepEqual(resolveFx({ sheetRate: 1380, manualRate: 1300 }), { rate: 1380, source: 'sheet' });
  assert.deepEqual(resolveFx({ sheetRate: null, manualRate: 1300 }), { rate: 1300, source: 'manual' });
  assert.deepEqual(resolveFx({ sheetRate: 0, manualRate: -5 }), { rate: null, source: 'none' });
  assert.deepEqual(resolveFx(), { rate: null, source: 'none' });
});

test('보유 종목이 0개여도 오류 없이 0을 돌려준다', () => {
  const result = valuePortfolio([], {});
  assert.equal(result.totalValue, 0);
  assert.equal(result.totalPnl, 0);
  assert.equal(result.totalReturn, null);
  assert.equal(result.dividendYield, null);
  assert.deepEqual(result.rows, []);
  assert.equal(valuePortfolio(undefined).totalValue, 0);
});

test('비중 = 원화 평가금액 / 합계, 비중의 합은 1', () => {
  const result = valuePortfolio([krw(), usd()], { fxRate: 1000 });
  assert.equal(result.totalValue, 700000 + 1000000);
  const weights = result.rows.map((row) => row.weight);
  assert.ok(Math.abs(weights[0] - 700000 / 1700000) < 1e-12);
  assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.equal(result.totalCost, 600000 + 800000);
  assert.equal(result.totalPnl, 100000 + 200000);
  assert.ok(Math.abs(result.totalReturn - 300000 / 1400000) < 1e-12);
});

test('환율이 없으면 달러 종목은 합계·비중에서 빠지고 개수를 알려준다', () => {
  const result = valuePortfolio([krw(), usd()], { fxRate: null });
  assert.equal(result.totalValue, 700000);
  assert.equal(result.missingFxCount, 1);
  assert.equal(result.rows[0].weight, 1);
  assert.equal(result.rows[1].weight, null);
});

test('모든 현재가가 0이면 합계 0, 비중은 계산하지 않는다', () => {
  const result = valuePortfolio([krw({ manualPrice: null, avgPrice: 0 })], {});
  assert.equal(result.totalValue, 0);
  assert.equal(result.rows[0].weight, null);
  assert.equal(result.rows[0].returnRate, null);
  assert.equal(result.avgPriceCount, 1);
});

test('수량 0인 종목(관심 종목)은 평가금액 0', () => {
  const result = valuePortfolio([krw(), krw({ id: 'z', quantity: 0 })], {});
  assert.equal(result.rows[1].valueKRW, 0);
  assert.equal(result.rows[1].weight, 0);
  assert.equal(result.rows[0].weight, 1);
});

test('예상 연 배당금: 주당 배당금 × 수량 × 환율, 없는 종목은 0으로 본다', () => {
  const result = valuePortfolio([
    krw({ dividendPerShare: 1444 }),
    usd({ dividendPerShare: 3 }),
    krw({ id: 'n', ticker: 'KRX:000660' }),
  ], { fxRate: 1000 });
  assert.equal(result.annualDividend, 10 * 1444 + 2 * 3 * 1000);
  assert.ok(Math.abs(result.dividendYield - result.annualDividend / result.totalValue) < 1e-12);
});
