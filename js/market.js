// 시세 상태: 마지막으로 받은 시세(캐시)와 지금 받아오는 중인지 여부.
// 시세가 바뀌면 subscribeMarket으로 등록한 화면에 알린다.

import { FX_TICKER, buildMarket, fetchSheetPrices, loadPriceCache, savePriceCache } from './price.js';
import {
  DIVIDEND_MAX_PER_REQUEST, dividendTickers, dividendsFor, dueDividendTickers, fetchDividends, loadDividendCache, mergeDividends, saveDividendCache,
} from './dividends.js';

// 시트 코드가 새 티커를 넣었는데 가격이 아직 없으면(구글 금융이 채우는 중) 잠시 뒤 다시 받는다
const FOLLOW_UP_MS = 6000;
const FOLLOW_UP_LIMIT = 3;

let backend = null;
let cache = null;
// 작년 배당금 (dividends.js). 시세와 따로 저장한다.
let dividendCache = null;
let dividendsLoading = false;
// state: idle | loading | ok | error, pending: 시트에 넣었지만 아직 가격을 기다리는 티커 수
let status = { state: 'idle', message: '', pending: 0 };
let latestRequest = 0;
let followUpTimer = null;
// 시트에 넣었지만 아직 가격을 기다리는 티커와, 다시 받아 본 횟수
const waiting = new Set();
let followUps = 0;
const listeners = new Set();

export function initMarket(storageBackend) {
  backend = storageBackend;
  cache = loadPriceCache(backend);
  dividendCache = loadDividendCache(backend);
}

// 화면에서 쓰는 시세 + 작년 배당금 ({ 티커: { perShare, count, currency, year } })
export function getMarket(state) {
  return { ...buildMarket({ cache, settings: state.settings }), dividends: dividendsFor(dividendCache, state.settings.sheetUrl) };
}

function notifyListeners() {
  for (const listener of [...listeners]) listener();
}

function storeDividends(sheetUrl, response) {
  dividendCache = mergeDividends(dividendCache, sheetUrl, response);
  try {
    saveDividendCache(backend, dividendCache);
  } catch {
    // 저장하지 못해도 이번 화면에서는 받은 값을 쓴다
  }
}

// 보유 종목 중 새로 물어볼 때가 된 티커의 작년 배당금을 받는다 (시세를 받은 뒤 조용히).
// 받지 못하면 저장해 둔 값이나 직접 적은 값을 그대로 쓴다.
export async function refreshDividends(sheetUrl, holdings) {
  if (!sheetUrl || dividendsLoading) return { ok: false };
  const due = dueDividendTickers(dividendCache, sheetUrl, dividendTickers(holdings));
  if (due.length === 0) return { ok: true, count: 0 };
  dividendsLoading = true;
  try {
    for (let start = 0; start < due.length; start += DIVIDEND_MAX_PER_REQUEST) {
      const response = await fetchDividends(sheetUrl, due.slice(start, start + DIVIDEND_MAX_PER_REQUEST));
      storeDividends(sheetUrl, response);
    }
    notifyListeners();
    return { ok: true, count: due.length };
  } catch (error) {
    return { ok: false, error };
  } finally {
    dividendsLoading = false;
  }
}

// 종목 추가 창에서 고른 종목 하나의 작년 배당금 (저장해 둔 값이 있으면 그것, 없으면 바로 물어본다)
//  돌려주는 값: { perShare, count, currency, year } | null (작년 배당 자료를 못 찾음). 연결·코드 문제면 DividendError를 던진다.
export async function lookupDividend(sheetUrl, ticker) {
  const known = dividendsFor(dividendCache, sheetUrl)[ticker];
  if (known && dueDividendTickers(dividendCache, sheetUrl, [ticker]).length === 0) return known;
  const response = await fetchDividends(sheetUrl, [ticker]);
  storeDividends(sheetUrl, response);
  notifyListeners();
  return dividendsFor(dividendCache, sheetUrl)[ticker] ?? null;
}

export function getPriceStatus() {
  return status;
}

// 시트에 새로 넣고 가격을 기다리는 티커 (구글 금융이 채우는 중)
export function getPendingTickers() {
  return [...waiting];
}

export function lastFetchedAt(sheetUrl) {
  return cache?.sheetUrl === sheetUrl ? cache.fetchedAt : null;
}

export function subscribeMarket(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setStatus(next) {
  status = { pending: 0, ...next };
  for (const listener of [...listeners]) listener();
}

function stopFollowUps() {
  clearTimeout(followUpTimer);
  followUpTimer = null;
  waiting.clear();
  followUps = 0;
}

export function resetPriceStatus() {
  latestRequest += 1;
  stopFollowUps();
  setStatus({ state: 'idle', message: '' });
}

function store(sheetUrl, data) {
  cache = { sheetUrl, fetchedAt: new Date().toISOString(), data };
  try {
    savePriceCache(backend, cache);
  } catch {
    // 캐시를 저장하지 못해도 이번 화면에서는 받은 시세를 그대로 쓴다.
  }
}

// 받은 시세를 쓰고, 시트에 새로 넣은 티커 중 가격이 아직 없는 것이 있으면 잠시 뒤 다시 받는다 (최대 3번).
// 그래도 가격이 없으면(티커가 틀렸거나 구글 금융에 없는 종목) 기다리지 않고 '가격 오류'로 보여 준다.
function accept(sheetUrl, data) {
  store(sheetUrl, data);
  clearTimeout(followUpTimer);
  followUpTimer = null;
  if (data.added.length > 0) {
    data.added.forEach((ticker) => waiting.add(ticker));
    followUps = 0;
  }
  for (const ticker of [...waiting]) {
    const priced = ticker === FX_TICKER ? Boolean(data.fx.USDKRW) : Object.hasOwn(data.prices, ticker);
    if (priced) waiting.delete(ticker);
  }
  if (waiting.size > 0 && followUps < FOLLOW_UP_LIMIT) {
    followUps += 1;
    followUpTimer = setTimeout(() => { refreshPrices(sheetUrl); }, FOLLOW_UP_MS);
  } else {
    waiting.clear();
    followUps = 0;
  }
  setStatus({ state: 'ok', message: '', pending: waiting.size });
}

// 시트에서 시세를 다시 받는다. 실패하면 마지막 시세를 그대로 쓴다.
//  tickers: 시트에 없으면 넣어 달라고 함께 보낼 보유 종목 티커 (sheetTickers)
// 돌려주는 값: { ok: true, added } | { ok: false, error } (더 새 요청에 밀린 경우 stale: true)
export async function refreshPrices(sheetUrl, { tickers = [] } = {}) {
  if (!sheetUrl) return { ok: false };
  latestRequest += 1;
  const requestId = latestRequest;
  setStatus({ state: 'loading', message: '', pending: waiting.size });
  try {
    const data = await fetchSheetPrices(sheetUrl, { tickers });
    if (requestId !== latestRequest) return { ok: false, stale: true };
    accept(sheetUrl, data);
    return { ok: true, added: data.added };
  } catch (error) {
    if (requestId !== latestRequest) return { ok: false, stale: true };
    setStatus({ state: 'error', message: error.message });
    return { ok: false, error };
  }
}

// 설정 화면의 연결 테스트. 지금 저장된 주소와 같으면 받은 시세를 바로 쓴다.
export async function testConnection(url, savedSheetUrl, { tickers = [] } = {}) {
  const data = await fetchSheetPrices(url, { tickers });
  if (url === savedSheetUrl) {
    latestRequest += 1;
    accept(url, data);
  }
  return data;
}
