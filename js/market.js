// 시세 상태: 마지막으로 받은 시세(캐시)와 지금 받아오는 중인지 여부.
// 시세가 바뀌면 subscribeMarket으로 등록한 화면에 알린다.

import { FX_TICKER, buildMarket, fetchSheetPrices, loadPriceCache, savePriceCache } from './price.js';

// 시트 코드가 새 티커를 넣었는데 가격이 아직 없으면(구글 금융이 채우는 중) 잠시 뒤 다시 받는다
const FOLLOW_UP_MS = 6000;
const FOLLOW_UP_LIMIT = 3;

let backend = null;
let cache = null;
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
}

export function getMarket(state) {
  return buildMarket({ cache, settings: state.settings });
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
