import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeDiversification, concentrationAlerts, holdingWeights, largestOf, splitByMix, toBreakdown,
} from '../js/calc/diversification.js';
import { valuePortfolio } from '../js/calc/valuation.js';
import { DEFAULT_SETTINGS, NON_SECTOR_NAMES } from '../js/constants.js';

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ''} ${actual} ≠ ${expected}`);

// 원화 평가금액이 value인 종목 (현재가 = 평단가 = value, 수량 1)
function holding(id, value, overrides = {}) {
  return {
    id, name: id, ticker: `KRX:${id}`, type: 'stock', currency: 'KRW', quantity: 1, avgPrice: value, manualPrice: value,
    account: '일반', assetClass: '성장주', countryMix: { 한국: 100 }, sectorMix: { 기술: 100 }, dividendPerShare: null, memo: '',
    ...overrides,
  };
}
const rowsOf = (holdings, fxRate = null) => valuePortfolio(holdings, { fxRate }).rows;
const weightOf = (breakdown, name) => breakdown.find((item) => item.name === name)?.weight ?? 0;

test('splitByMix: 합계 100이면 비율대로 나눈다', () => {
  assert.deepEqual(splitByMix(1000, { 미국: 60, 한국: 40 }), [['미국', 600], ['한국', 400]]);
});

test('splitByMix: 합계가 100보다 작으면 나머지는 미분류, 크면 합계에 맞춰 줄인다', () => {
  assert.deepEqual(splitByMix(1000, { 미국: 50 }), [['미국', 500], ['미분류', 500]]);
  assert.deepEqual(splitByMix(1000, { 미국: 60, 한국: 60 }), [['미국', 500], ['한국', 500]]);
  assert.deepEqual(splitByMix(1000, {}), [['미분류', 1000]]);
  assert.deepEqual(splitByMix(1000, null), [['미분류', 1000]]);
});

test('splitByMix: 33.33 + 33.33 + 33.34 처럼 소수 합계도 미분류 없이 금액이 맞는다', () => {
  const parts = splitByMix(900, { a: 33.33, b: 33.33, c: 33.34 });
  assert.equal(parts.length, 3);
  near(parts.reduce((sum, [, amount]) => sum + amount, 0), 900);
});

test('요청서 6-2: 국가 비중 = Σ(평가금액 × countryMix / 100) / 합계', () => {
  const rows = rowsOf([
    holding('a', 1_000_000, { countryMix: { 미국: 100 } }),
    holding('b', 1_000_000, { type: 'etf', countryMix: { 미국: 60, 한국: 40 } }),
  ]);
  const { country } = analyzeDiversification(rows);
  near(weightOf(country, '미국'), 0.8);
  near(weightOf(country, '한국'), 0.2);
  assert.deepEqual(country.map((item) => item.name), ['미국', '한국']);
});

test('섹터 비율 합계가 100이 아닌 ETF는 나머지를 미분류로 보여준다', () => {
  const rows = rowsOf([holding('qqq', 1_000_000, { type: 'etf', sectorMix: { 기술: 50, 통신: 15 } })]);
  const { sector } = analyzeDiversification(rows);
  near(weightOf(sector, '기술'), 0.5);
  near(weightOf(sector, '미분류'), 0.35);
  near(sector.reduce((sum, item) => sum + item.weight, 0), 1);
});

test('자산군·계좌 집계, 금액이 없는 종목(환율 없음·수량 0)은 빠진다', () => {
  const rows = rowsOf([
    holding('a', 3_000_000, { account: 'ISA' }),
    holding('b', 1_000_000, { assetClass: '배당주' }),
    holding('usd', 100, { currency: 'USD' }),
    holding('zero', 0, { quantity: 0 }),
  ]);
  const result = analyzeDiversification(rows);
  assert.equal(result.stockTotal, 4_000_000);
  near(weightOf(result.assetClass, '성장주'), 0.75);
  near(weightOf(result.account, 'ISA'), 0.75);
  near(weightOf(result.account, '일반'), 0.25);
  assert.equal(result.othersTotal, 0);
});

test('보유 종목이 없으면 빈 집계', () => {
  const result = analyzeDiversification([]);
  assert.equal(result.stockTotal, 0);
  assert.deepEqual([result.country, result.sector, result.assetClass, result.account], [[], [], [], []]);
});

test('전체 보기: 자산군·계좌에만 기타 금융자산을 더하고, 계좌 연결 연금은 이중으로 더하지 않는다', () => {
  const rows = rowsOf([holding('a', 2_000_000, { account: 'IRP' })]);
  const otherAssets = [{ balance: 5_000_000 }, { balance: 'x' }];
  const pensions = [
    { kind: 'accumulating', balance: 3_000_000, linkedAccount: null },
    { kind: 'accumulating', balance: 9_999_999, linkedAccount: 'IRP' },
    { kind: 'fixed', expectedMonthlyAmount: 1_000_000 },
  ];
  const result = analyzeDiversification(rows, { includeOthers: true, otherAssets, pensions });
  assert.equal(result.othersTotal, 8_000_000);
  assert.equal(result.total, 10_000_000);
  near(weightOf(result.assetClass, '예적금·공제회'), 0.5);
  near(weightOf(result.assetClass, '연금 적립금'), 0.3);
  near(weightOf(result.assetClass, '성장주'), 0.2);
  near(weightOf(result.account, '기타 금융자산'), 0.8);
  near(weightOf(result.account, 'IRP'), 0.2);
  // 국가·섹터는 주식만
  assert.deepEqual(result.country, analyzeDiversification(rows).country);

  const stocksOnly = analyzeDiversification(rows, { otherAssets, pensions });
  assert.deepEqual(stocksOnly.assetClass.map((item) => item.name), ['성장주']);
});

test('같은 종목을 여러 계좌에 나눠 가지면 한 종목으로 합친다', () => {
  const rows = rowsOf([
    holding('a', 1_000_000, { ticker: 'KRX:005930', name: '삼성전자', account: '일반' }),
    holding('b', 2_000_000, { ticker: 'KRX:005930', name: '삼성전자', account: 'ISA' }),
    holding('c', 1_000_000),
  ]);
  const weights = holdingWeights(rows);
  assert.equal(weights.length, 2);
  assert.equal(weights[0].ticker, 'KRX:005930');
  near(weights[0].weight, 0.75);
});

test('toBreakdown / largestOf', () => {
  const breakdown = toBreakdown([['기타', 50], ['기술', 30], ['기술', 10], ['소재', 0], ['통신', -5]]);
  assert.deepEqual(breakdown.map((item) => [item.name, item.value]), [['기타', 50], ['기술', 40]]);
  assert.equal(largestOf(breakdown, NON_SECTOR_NAMES).name, '기술');
  assert.equal(largestOf([{ name: '기타', weight: 1 }], NON_SECTOR_NAMES), null);
});

test('쏠림 경고: 요청서 예시 문장과 같은 형식', () => {
  const rows = rowsOf([
    holding('a', 5_200_000, { sectorMix: { 기술: 100 }, countryMix: { 미국: 50, 한국: 50 } }),
    holding('b', 4_800_000, { sectorMix: { 금융: 100 }, countryMix: { 미국: 50, 한국: 50 } }),
  ]);
  const stocks = analyzeDiversification(rows);
  const alerts = concentrationAlerts({ ...stocks, holdings: [] }, DEFAULT_SETTINGS);
  assert.deepEqual(alerts.map((alert) => alert.message), [
    '기술 섹터가 52%예요. 기술주가 함께 떨어지면 자산이 크게 흔들릴 수 있어요.',
    '금융 섹터가 48%예요. 금융주가 함께 떨어지면 자산이 크게 흔들릴 수 있어요.',
  ]);
});

test('쏠림 경고: 국가·한 종목, 채권·기타·미분류는 섹터 경고에서 뺀다, 기준은 설정을 따른다', () => {
  const rows = rowsOf([
    holding('bond', 6_000_000, { name: '국고채ETF', type: 'etf', assetClass: '채권', sectorMix: { 채권: 100 } }),
    holding('cash', 2_000_000, { name: '현금성ETF', type: 'etf', sectorMix: { 기타: 50 } }),
    holding('sam', 2_000_000, { name: '삼성전자', sectorMix: { 헬스케어: 100 } }),
  ]);
  const stocks = analyzeDiversification(rows);
  const alerts = concentrationAlerts({ ...stocks, holdings: holdingWeights(rows) }, DEFAULT_SETTINGS);
  assert.deepEqual(alerts.map((alert) => [alert.kind, alert.name]), [
    ['country', '한국'],
    ['single', '국고채ETF'],
  ]);
  assert.match(alerts[0].message, /^한국 비중이 100%예요\. 한국 주식시장이/);
  assert.match(alerts[1].message, /ETF는 여러 회사를 담고 있어/);

  const strict = concentrationAlerts({ ...stocks, holdings: holdingWeights(rows) }, { warnSector: 10, warnCountry: 100, warnSingle: 15 });
  assert.deepEqual(strict.map((alert) => [alert.kind, alert.name]), [
    ['sector', '헬스케어'],
    ['single', '국고채ETF'],
    ['single', '현금성ETF'],
    ['single', '삼성전자'],
  ]);
  assert.match(strict[0].message, /헬스케어 주식이 함께 떨어지면/);
  assert.match(strict[3].message, /^삼성전자 한 종목이 20%예요\. 이 회사에/);
});
