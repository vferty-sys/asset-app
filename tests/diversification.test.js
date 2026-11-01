import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeDiversification, concentrationAlerts, holdingWeights, largestOf, splitByMix, toBreakdown,
} from '../js/calc/diversification.js';
import { valuePortfolio } from '../js/calc/valuation.js';
import { DEFAULT_SETTINGS, NON_COUNTRY_NAMES, NON_SECTOR_NAMES } from '../js/constants.js';

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

test('국가 쏠림 규격: 다국가 ETF는 비중표로 나눠 나라별로 더한다 (국가 i 비중 = Σ 평가금액 × i 비중 / 합계)', () => {
  const rows = rowsOf([
    holding('samsung', 1_000_000, { countryMix: { 한국: 100 } }), // 개별 주식: 본사 나라
    holding('sp500', 1_000_000, { type: 'etf', countryMix: { 미국: 100 } }), // 국내 상장이어도 미국에 투자
    holding('world', 1_000_000, { type: 'etf', countryMix: { 한국: 100 }, countryPreset: 'MSCI World' }), // 비중표가 우선
    holding('em', 1_000_000, { type: 'etf', countryPreset: 'MSCI EM' }),
  ]);
  const { country } = analyzeDiversification(rows);
  near(weightOf(country, '미국'), (1 + 0.72) / 4);
  near(weightOf(country, '한국'), (1 + 0.09) / 4);
  near(weightOf(country, '중국'), 0.28 / 4);
  near(weightOf(country, '일본'), 0.055 / 4);
  near(weightOf(country, '기타'), (0.065 + 0.195) / 4);
  near(country.reduce((sum, item) => sum + item.weight, 0), 1);
  assert.equal(weightOf(country, '미분류'), 0);
});

test('비중표에 없는 다국가 ETF는 글로벌(다국가)로 모으고, 국가 쏠림 경고·점수에서는 뺀다', () => {
  const rows = rowsOf([
    holding('kr', 3_000_000, { countryMix: { 한국: 100 } }),
    holding('global', 7_000_000, { type: 'etf', countryMix: { '글로벌(다국가)': 100 } }),
    holding('gone', 1_000_000, { type: 'etf', countryMix: { 미국: 100 }, countryPreset: '비중표에서 빠진 지수' }),
  ]);
  const stocks = analyzeDiversification(rows);
  near(weightOf(stocks.country, '글로벌(다국가)'), 8 / 11);
  assert.equal(largestOf(stocks.country, NON_COUNTRY_NAMES).name, '한국');
  const alerts = concentrationAlerts({ ...stocks, holdings: [] }, { ...DEFAULT_SETTINGS, warnSector: 100 });
  assert.deepEqual(alerts.filter((alert) => alert.kind === 'country').map((alert) => alert.name), []);
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
  assert.equal(weights[0].parts, 1);
});

test('ETF는 분산 정도에 따라 몇 종목으로 나눠 볼지 정한다 (채권·현금성 ETF는 시장 전체형처럼)', () => {
  const etf = (id, overrides) => holding(id, 100, { type: 'etf', ...overrides });
  const weights = holdingWeights(rowsOf([
    etf('m', { etfSpread: 'market' }), etf('t', { etfSpread: 'theme' }), etf('s', { etfSpread: 'single' }),
    etf('n', {}), etf('b', { etfSpread: 'single', assetClass: '채권' }), etf('c', { assetClass: '현금성' }), holding('k', 100),
  ]));
  const byId = Object.fromEntries(weights.map((item) => [item.ticker.split(':')[1], [item.spread, item.parts]]));
  assert.deepEqual(byId, {
    m: ['market', 10], t: ['theme', 3], s: ['single', 1], n: ['theme', 3], b: ['market', 10], c: ['market', 10], k: [null, 1],
  });
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
  // 채권 ETF 60%는 시장 전체형처럼 6%짜리 10곳, 분산 정도를 안 고른 ETF 20%는 업종·테마형처럼 6.7%짜리 3곳으로 본다
  const alerts = concentrationAlerts({ ...stocks, holdings: holdingWeights(rows) }, DEFAULT_SETTINGS);
  assert.deepEqual(alerts.map((alert) => [alert.kind, alert.name]), [['country', '한국']]);
  assert.match(alerts[0].message, /^한국 비중이 100%예요\. 한국 주식시장이/);

  const strict = concentrationAlerts({ ...stocks, holdings: holdingWeights(rows) }, { warnSector: 10, warnCountry: 100, warnSingle: 15 });
  assert.deepEqual(strict.map((alert) => [alert.kind, alert.name]), [
    ['sector', '헬스케어'],
    ['single', '삼성전자'],
  ]);
  assert.match(strict[0].message, /헬스케어 주식이 함께 떨어지면/);
  assert.match(strict[1].message, /^삼성전자 한 종목이 20%예요\. 이 회사에/);
});

test('한 종목 쏠림: ETF는 분산 정도만큼 나눈 한 곳의 비중으로 판단한다', () => {
  const alertsFor = (overrides) => {
    const rows = rowsOf([holding('etf', 9_000, { name: '이 ETF', type: 'etf', ...overrides }), holding('s', 1_000)]);
    return concentrationAlerts({ holdings: holdingWeights(rows) }, DEFAULT_SETTINGS).filter((alert) => alert.kind === 'single');
  };
  // 90% → 시장 전체형 9%씩 10곳(경고 없음), 업종·테마형 30%씩 3곳(경고), 집중형 90% 한 곳(경고)
  assert.equal(alertsFor({ etfSpread: 'market' }).length, 0);
  assert.match(alertsFor({ etfSpread: 'theme' })[0].message, /^이 ETF 한 상품이 90%예요\. 같은 업종·주제의 회사들은/);
  assert.match(alertsFor({ etfSpread: 'single' })[0].message, /레버리지·인버스·단일 종목처럼/);
  // 채권 ETF는 고른 값과 상관없이 시장 전체형처럼
  assert.equal(alertsFor({ etfSpread: 'single', assetClass: '채권' }).length, 0);
});
