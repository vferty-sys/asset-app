// 시세 상태: 마지막으로 받은 시세(캐시)와 지금 받아오는 중인지 여부.
// 시세가 바뀌면 subscribeMarket으로 등록한 화면에 알린다.

import { buildMarket, fetchSheetPrices, loadPriceCache, savePriceCache } from './price.js';

let backend = null;
let cache = null;
let status = { state: 'idle', message: '' }; // idle | loading | ok | error
let latestRequest = 0;
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

export function lastFetchedAt(sheetUrl) {
  return cache?.sheetUrl === sheetUrl ? cache.fetchedAt : null;
}

export function subscribeMarket(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setStatus(next) {
  status = next;
  for (const listener of [...listeners]) listener();
}

export function resetPriceStatus() {
  latestRequest += 1;
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

// 시트에서 시세를 다시 받는다. 실패하면 마지막 시세를 그대로 쓴다.
// 돌려주는 값: { ok: true } | { ok: false, error } (더 새 요청에 밀린 경우 stale: true)
export async function refreshPrices(sheetUrl) {
  if (!sheetUrl) return { ok: false };
  latestRequest += 1;
  const requestId = latestRequest;
  setStatus({ state: 'loading', message: '' });
  try {
    const data = await fetchSheetPrices(sheetUrl);
    if (requestId !== latestRequest) return { ok: false, stale: true };
    store(sheetUrl, data);
    setStatus({ state: 'ok', message: '' });
    return { ok: true };
  } catch (error) {
    if (requestId !== latestRequest) return { ok: false, stale: true };
    setStatus({ state: 'error', message: error.message });
    return { ok: false, error };
  }
}

// 설정 화면의 연결 테스트. 지금 저장된 주소와 같으면 받은 시세를 바로 쓴다.
export async function testConnection(url, savedSheetUrl) {
  const data = await fetchSheetPrices(url);
  if (url === savedSheetUrl) {
    latestRequest += 1;
    store(url, data);
    setStatus({ state: 'ok', message: '' });
  }
  return data;
}
