import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEYS } from '../js/constants.js';
import { createMemoryBackend } from '../js/storage.js';
import {
  PriceError, buildMarket, fetchSheetPrices, findPriceIssues, loadPriceCache, parseSheetResponse, savePriceCache,
} from '../js/price.js';

const SHEET_URL = 'https://script.google.com/macros/s/AKfyTEST/exec';

// 요청서 4-2의 예시 응답
const SAMPLE = {
  updatedAt: '2026-10-30T10:00:00+09:00',
  fx: { USDKRW: 1380.5 },
  prices: {
    'KRX:005930': { price: 61000, currency: 'KRW' },
    'NASDAQ:QQQ': { price: 512.3, currency: 'USD' },
  },
  errors: ['KRX:123456'],
};

const respond = (body, init) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), init);

test('요청서 4-2 형식의 응답을 읽는다', () => {
  assert.deepEqual(parseSheetResponse(SAMPLE), {
    updatedAt: '2026-10-30T01:00:00.000Z',
    fx: { USDKRW: 1380.5 },
    prices: {
      'KRX:005930': { price: 61000, currency: 'KRW' },
      'NASDAQ:QQQ': { price: 512.3, currency: 'USD' },
    },
    errors: ['KRX:123456'],
  });
});

test('티커는 앱과 같은 형식으로 정리하고, 가격이 이상한 티커는 errors로 옮긴다', () => {
  const now = new Date('2026-10-30T00:00:00Z');
  const data = parseSheetResponse({
    prices: {
      ' krx:005930 ': { price: 61000, currency: 'krw' },
      'NASDAQ:QQQ': { price: '#N/A' },
      'NYSE:KO': { price: 0 },
      'NYSE:T': null,
    },
    errors: ['kosdaq:000001', 'KRX:005930'],
  }, { now });
  assert.deepEqual(data.prices, { 'KRX:005930': { price: 61000, currency: 'KRW' } });
  assert.deepEqual([...data.errors].sort(), ['KOSDAQ:000001', 'NASDAQ:QQQ', 'NYSE:KO', 'NYSE:T']);
  assert.equal(data.fx.USDKRW, null);
  assert.equal(data.updatedAt, now.toISOString());
});

test('형식이 다르면 사용자에게 보여줄 오류를 낸다', () => {
  for (const bad of [null, [], 'text', { foo: 1 }, { prices: [] }]) {
    assert.throws(() => parseSheetResponse(bad), (error) => error instanceof PriceError && error.code === 'format');
  }
  assert.throws(() => parseSheetResponse({ error: '시트를 찾을 수 없음' }),
    (error) => error.code === 'script' && error.message.includes('시트를 찾을 수 없음'));
});

test('시트 주소로 GET 요청만 보내고 쿠키·본문은 보내지 않는다', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify(SAMPLE));
  };
  const data = await fetchSheetPrices(SHEET_URL, { fetchImpl });
  assert.equal(data.prices['NASDAQ:QQQ'].price, 512.3);
  assert.equal(seen.url, SHEET_URL);
  assert.equal(seen.init.method, 'GET');
  assert.equal(seen.init.credentials, 'omit');
  assert.equal(seen.init.body, undefined);
  assert.equal(seen.init.headers, undefined);
});

test('웹 앱이 아닌 페이지(로그인 화면 등)를 받으면 not-json 오류', async () => {
  await assert.rejects(fetchSheetPrices(SHEET_URL, { fetchImpl: respond('<!doctype html><title>Sign in</title>') }),
    (error) => error.code === 'not-json' && /모든 사용자/.test(error.message));
});

test('HTTP 오류 코드를 알려준다', async () => {
  await assert.rejects(fetchSheetPrices(SHEET_URL, { fetchImpl: respond('Not found', { status: 404 }) }),
    (error) => error.code === 'http' && error.message.includes('404'));
});

test('네트워크 오류', async () => {
  const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(fetchSheetPrices(SHEET_URL, { fetchImpl }), (error) => error.code === 'network');
});

test('응답이 없으면 시간 초과', async () => {
  const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  await assert.rejects(fetchSheetPrices(SHEET_URL, { fetchImpl, timeoutMs: 20 }), (error) => error.code === 'timeout');
});

test('시세 캐시: 저장한 그대로 읽고, 없거나 깨졌으면 null', () => {
  const backend = createMemoryBackend();
  const cache = { sheetUrl: SHEET_URL, fetchedAt: '2026-10-30T01:00:00.000Z', data: parseSheetResponse(SAMPLE) };
  savePriceCache(backend, cache);
  assert.deepEqual(loadPriceCache(backend), cache);

  assert.equal(loadPriceCache(createMemoryBackend()), null);
  assert.equal(loadPriceCache(createMemoryBackend({ [STORAGE_KEYS.priceCache]: '{깨짐' })), null);
  assert.equal(loadPriceCache(createMemoryBackend({ [STORAGE_KEYS.priceCache]: '{"sheetUrl":1,"data":{}}' })), null);
  assert.equal(loadPriceCache(createMemoryBackend({ [STORAGE_KEYS.priceCache]: '{"sheetUrl":"x","data":{"prices":3}}' })), null);
});

const settings = (overrides = {}) => ({ sheetUrl: '', manualFxUsdKrw: null, ...overrides });
const cache = { sheetUrl: SHEET_URL, fetchedAt: '2026-10-30T01:00:00.000Z', data: parseSheetResponse(SAMPLE) };

test('시트 주소가 없으면 직접 입력 모드: 캐시가 있어도 쓰지 않는다', () => {
  const market = buildMarket({ cache, settings: settings({ manualFxUsdKrw: 1300 }) });
  assert.equal(market.mode, 'manual');
  assert.equal(market.hasData, false);
  assert.deepEqual(market.prices, {});
  assert.deepEqual(market.fx, { rate: 1300, source: 'manual' });
});

test('지금 설정된 시트 주소에서 받은 캐시만 쓴다', () => {
  const same = buildMarket({ cache, settings: settings({ sheetUrl: SHEET_URL, manualFxUsdKrw: 1300 }) });
  assert.equal(same.mode, 'sheet');
  assert.equal(same.hasData, true);
  assert.equal(same.prices['KRX:005930'].price, 61000);
  assert.deepEqual(same.fx, { rate: 1380.5, source: 'sheet' });
  assert.equal(same.updatedAt, '2026-10-30T01:00:00.000Z');

  const other = buildMarket({ cache, settings: settings({ sheetUrl: `${SHEET_URL}x`, manualFxUsdKrw: 1300 }) });
  assert.equal(other.hasData, false);
  assert.deepEqual(other.prices, {});
  assert.deepEqual(other.fx, { rate: 1300, source: 'manual' });
  assert.equal(buildMarket({ cache: null, settings: settings({ sheetUrl: SHEET_URL }) }).fx.source, 'none');
});

test('시트 환율이 없으면 직접 입력한 환율을 쓴다', () => {
  const noFx = { ...cache, data: { ...cache.data, fx: { USDKRW: null } } };
  assert.deepEqual(buildMarket({ cache: noFx, settings: settings({ sheetUrl: SHEET_URL, manualFxUsdKrw: 1300 }) }).fx, { rate: 1300, source: 'manual' });
});

test('가격을 못 받은 종목 찾기: 시트에 없음 / 시트 오류 / 통화 다름', () => {
  const market = buildMarket({ cache, settings: settings({ sheetUrl: SHEET_URL }) });
  const holdings = [
    { ticker: 'KRX:005930', currency: 'KRW' },
    { ticker: 'KRX:005930', currency: 'KRW' },
    { ticker: 'NASDAQ:QQQ', currency: 'KRW' },
    { ticker: 'KRX:123456', currency: 'KRW' },
    { ticker: 'NYSE:KO', currency: 'USD' },
  ];
  assert.deepEqual(findPriceIssues(holdings, market), {
    notInSheet: ['NYSE:KO'],
    sheetErrors: ['KRX:123456'],
    currencyMismatch: ['NASDAQ:QQQ'],
  });
});

test('직접 입력 모드이거나 아직 시세가 없으면 문제를 찾지 않는다', () => {
  const holdings = [{ ticker: 'NYSE:KO', currency: 'USD' }];
  const empty = { notInSheet: [], sheetErrors: [], currencyMismatch: [] };
  assert.deepEqual(findPriceIssues(holdings, buildMarket({ cache, settings: settings() })), empty);
  assert.deepEqual(findPriceIssues(holdings, buildMarket({ cache: null, settings: settings({ sheetUrl: SHEET_URL }) })), empty);
});
