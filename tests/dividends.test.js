// 앱 쪽 작년 배당금: 시트 코드에 묻기, 이 기기에 저장, 어느 값을 쓸지, 화면 안내
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DividendError, dividendBasis, dividendTickers, dividendsFor, dueDividendTickers, fetchDividends, loadDividendCache, mergeDividends,
  saveDividendCache,
} from '../js/dividends.js';
import { resolveDividend, valuePortfolio } from '../js/calc/valuation.js';
import { normalizeHolding, validateHolding } from '../js/holding.js';
import { createMemoryBackend } from '../js/storage.js';
import { FakeSheet, fakeWebAppFetch, load } from './helpers/apps-script-harness.js';

const SHEET = 'https://script.google.com/macros/s/abc/exec';
const respond = (body) => async () => new Response(JSON.stringify(body));
const NOW = new Date('2026-11-05T09:00:00');

test('물어볼 티커: 국내·미국 거래소 티커만, 중복 없이', () => {
  const holdings = [
    { ticker: 'KRX:005930' }, { ticker: 'KRX:005930' }, { ticker: 'NASDAQ:QQQ' }, { ticker: 'NYSE:BRK.B' },
    { ticker: 'TYO:7203' }, { ticker: 'KOSDAQ:247540' }, { ticker: '' },
  ];
  assert.deepEqual(dividendTickers(holdings), ['KRX:005930', 'NASDAQ:QQQ', 'NYSE:BRK.B', 'KOSDAQ:247540']);
});

test('시트 코드 응답 읽기: 이상한 값은 버리고, 예전 시트 코드면 no-feature', async () => {
  const result = await fetchDividends(SHEET, ['KRX:005930', 'NASDAQ:QQQ'], {
    fetchImpl: respond({ year: 2025, dividends: { 'KRX:005930': { perShare: 1444, count: 4, currency: 'KRW' }, bad: { perShare: -1 }, 'NASDAQ:QQQ': { perShare: '2.8' } }, failed: ['X', 3] }),
  });
  assert.equal(result.year, 2025);
  assert.deepEqual(result.dividends, { 'KRX:005930': { perShare: 1444, count: 4, currency: 'KRW' }, 'NASDAQ:QQQ': { perShare: 2.8, count: 0, currency: '' } });
  assert.deepEqual(result.failed, ['X']);
  await assert.rejects(fetchDividends(SHEET, ['KRX:005930'], { fetchImpl: respond({ prices: {}, fx: {} }) }), (error) => error instanceof DividendError && error.code === 'no-feature' && /최신/.test(error.message));
  await assert.rejects(fetchDividends('', ['KRX:005930']), (error) => error.code === 'no-sheet');
  await assert.rejects(fetchDividends(SHEET, ['KRX:005930'], { fetchImpl: async () => { throw new TypeError('x'); } }), (error) => error.code === 'network');
});

test('앱 → 시트 코드 → (가짜) 야후: 작년 배당을 받아 온다', async () => {
  const year = new Date().getFullYear() - 1;
  const at = (month, day) => Math.floor(Date.UTC(year, month - 1, day) / 1000);
  const body = JSON.stringify({ chart: { result: [{ meta: { currency: 'USD' }, events: { dividends: { a: { amount: 0.5, date: at(3, 20) }, b: { amount: 0.5, date: at(9, 20) } } } }] } });
  const { context, calls } = load([new FakeSheet('시세', 1, [['티커', '가격', '통화']])], { fetch: () => ({ status: 200, body }) });
  const result = await fetchDividends(SHEET, ['NYSEARCA:SCHD'], { fetchImpl: fakeWebAppFetch(context) });
  assert.deepEqual(result.dividends['NYSEARCA:SCHD'], { perShare: 1, count: 2, currency: 'USD' });
  assert.ok(calls.fetches[0].includes('/chart/SCHD?'), '야후에는 심볼만 보낸다');
});

test('이 기기에 저장: 합치기, 일주일 지나면 다시, 실패는 하루 뒤 다시, 작년이 바뀌면 처음부터', () => {
  let cache = mergeDividends(null, SHEET, { year: 2025, dividends: { 'KRX:005930': { perShare: 1444, count: 4, currency: 'KRW' } }, failed: ['NASDAQ:GONE'] }, NOW);
  const backend = createMemoryBackend();
  saveDividendCache(backend, cache);
  cache = loadDividendCache(backend);
  assert.deepEqual(dividendsFor(cache, SHEET, NOW), { 'KRX:005930': { perShare: 1444, count: 4, currency: 'KRW', year: 2025 } });
  assert.deepEqual(dividendsFor(cache, 'https://other/exec', NOW), {}, '다른 시트 주소');
  const tickers = ['KRX:005930', 'NASDAQ:GONE', 'NASDAQ:QQQ'];
  assert.deepEqual(dueDividendTickers(cache, SHEET, tickers, NOW), ['NASDAQ:QQQ'], '처음 보는 티커만');
  const nextDay = new Date(NOW.getTime() + 25 * 3600 * 1000);
  assert.deepEqual(dueDividendTickers(cache, SHEET, tickers, nextDay), ['NASDAQ:GONE', 'NASDAQ:QQQ'], '실패한 티커는 하루 뒤 다시');
  const nextWeek = new Date(NOW.getTime() + 8 * 24 * 3600 * 1000);
  assert.deepEqual(dueDividendTickers(cache, SHEET, tickers, nextWeek), tickers, '일주일 지나면 다시');
  const nextYear = new Date('2027-01-03T09:00:00');
  assert.deepEqual(dividendsFor(cache, SHEET, nextYear), {}, '2027년에는 2025년 배당을 쓰지 않음');
  assert.deepEqual(dueDividendTickers(cache, SHEET, tickers, nextYear), tickers);
  const reset = mergeDividends(cache, SHEET, { year: 2026, dividends: { 'NASDAQ:QQQ': { perShare: 3, count: 4, currency: 'USD' } }, failed: [] }, nextYear);
  assert.deepEqual(Object.keys(reset.data), ['NASDAQ:QQQ']);
  assert.equal(loadDividendCache(createMemoryBackend({ 'assetApp.dividendCache': '{망가진' })), null);
});

test('어느 배당금을 쓸지: 직접 적기 → 작년 배당(통화가 같을 때) → 예전에 적어 둔 값', () => {
  const dividends = { 'NASDAQ:QQQ': { perShare: 2.8, count: 4, currency: 'USD', year: 2025 } };
  const qqq = { ticker: 'NASDAQ:QQQ', currency: 'USD', dividendPerShare: 1 };
  assert.deepEqual(resolveDividend(qqq, dividends), { perShare: 2.8, source: 'auto', year: 2025, count: 4 });
  assert.deepEqual(resolveDividend({ ...qqq, dividendManual: true }, dividends), { perShare: 1, source: 'manual' });
  assert.deepEqual(resolveDividend(qqq, {}), { perShare: 1, source: 'saved' });
  assert.deepEqual(resolveDividend({ ...qqq, currency: 'KRW' }, dividends), { perShare: 1, source: 'saved' }, '통화가 다르면 자동 값을 안 씀');
  assert.deepEqual(resolveDividend({ ticker: 'X', currency: 'KRW', dividendPerShare: null }, {}), { perShare: null, source: 'none' });
  assert.equal(resolveDividend({ ticker: 'KRX:000660', currency: 'KRW' }, { 'KRX:000660': { perShare: 0, currency: 'KRW', year: 2025 } }).perShare, 0, '배당이 없었던 해는 0');
});

test('포트폴리오 배당금: 자동 값을 원화로 더하고, 어디서 가져왔는지 센다', () => {
  const holdings = [
    { ticker: 'NASDAQ:QQQ', currency: 'USD', quantity: 10, avgPrice: 400, manualPrice: 500, dividendPerShare: 1 },
    { ticker: 'KRX:005930', currency: 'KRW', quantity: 100, avgPrice: 60000, manualPrice: 70000, dividendPerShare: 1000, dividendManual: true },
    { ticker: 'KRX:069500', currency: 'KRW', quantity: 10, avgPrice: 30000, manualPrice: 36000, dividendPerShare: 500 },
  ];
  const dividends = { 'NASDAQ:QQQ': { perShare: 3, count: 4, currency: 'USD', year: 2025 }, 'KRX:005930': { perShare: 1444, count: 4, currency: 'KRW', year: 2025 } };
  const portfolio = valuePortfolio(holdings, { fxRate: 1400, dividends });
  assert.equal(portfolio.annualDividend, 10 * 3 * 1400 + 100 * 1000 + 10 * 500);
  assert.deepEqual(portfolio.dividendSources, { auto: 1, manual: 1, saved: 1, none: 0 });
  assert.equal(portfolio.dividendYear, 2025);
  assert.equal(dividendBasis(portfolio), '작년(2025년) 배당 기준 · 직접 적은 값 2종목');
  assert.equal(dividendBasis(valuePortfolio([], {})), null);
});

test('종목 데이터: 직접 적기 여부를 저장한다 (예전 데이터는 자동)', () => {
  assert.equal(normalizeHolding({ ticker: 'KRX:005930', dividendPerShare: 1444 }).dividendManual, false);
  assert.equal(normalizeHolding({ ticker: 'KRX:005930', dividendManual: true }).dividendManual, true);
  const base = {
    name: '삼성전자', ticker: 'KRX:005930', type: 'stock', currency: 'KRW', quantity: '10', avgPrice: '60000', account: '일반', assetClass: '성장주',
    countryRows: [{ name: '한국', percent: '' }], sectorRows: [{ name: '기술', percent: '' }], dividendPerShare: '1,444',
  };
  assert.equal(validateHolding({ ...base, dividendManual: true }).value.dividendManual, true);
  assert.equal(validateHolding(base).value.dividendManual, false);
  assert.equal(validateHolding(base).value.dividendPerShare, 1444);
});
