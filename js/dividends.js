// 작년 배당금: 내 구글 시트 코드에 보유 종목 티커의 작년(1~12월) 1주당 배당금 합계를 물어본다.
// 시트 코드가 야후 파이낸스 공개 자료에서 받아 저장해 두고 돌려준다. 앱은 이 값을 '올해 예상 배당금'으로 쓴다.
// 받은 값은 이 기기에만 저장한다 (시세 캐시처럼 앱 데이터·백업과 따로).

import { STORAGE_KEYS } from './constants.js';
import { isPlainObject } from './validate.js';

export const DIVIDEND_FEATURE = 'dividends';
export const DIVIDEND_TIMEOUT_MS = 40000;
// 같은 해의 값도 일주일마다 다시 물어본다 (시트 코드가 저장해 두었다가 바로 답하므로 가볍다)
export const DIVIDEND_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
// 받지 못한 티커는 하루 동안 다시 묻지 않는다
export const DIVIDEND_RETRY_MS = 24 * 60 * 60 * 1000;
const MAX_PER_REQUEST = 40;
// 시트 코드가 배당금을 찾을 수 있는 거래소 (국내, 미국)
const SUPPORTED = /^(KRX|KOSDAQ|NASDAQ|NYSE|NYSEARCA|NYSEAMERICAN|NYSEMKT|AMEX|BATS|CBOE):[A-Z0-9][A-Z0-9.-]*$/;

export class DividendError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DividendError';
    this.code = code;
  }
}

const MESSAGES = {
  'no-sheet': '구글 시트를 연결하면 작년 배당금을 자동으로 넣어요.',
  'no-feature': '시트 코드를 최신으로 바꾸면 작년 배당금을 자동으로 넣어요.',
  network: '시트에 연결하지 못했어요.',
  timeout: '배당금을 받는 데 시간이 너무 오래 걸려요.',
  api: '배당금을 받지 못했어요.',
};

export const isDividendTicker = (ticker) => SUPPORTED.test(String(ticker ?? ''));

// 배당금을 물어볼 티커: 보유 종목 중 국내·미국 거래소 티커 (중복 없이)
export function dividendTickers(holdings) {
  return [...new Set((holdings ?? []).map((holding) => holding.ticker).filter(isDividendTicker))];
}

const lastYear = (now) => now.getFullYear() - 1;

// 시트 코드에 묻는다 → { year, dividends: { 티커: { perShare, count, currency } }, failed: [], unsupported: [] }
export async function fetchDividends(sheetUrl, tickers, { fetchImpl = globalThis.fetch, timeoutMs = DIVIDEND_TIMEOUT_MS } = {}) {
  if (!sheetUrl) throw new DividendError('no-sheet', MESSAGES['no-sheet']);
  const url = new URL(sheetUrl);
  url.searchParams.set('action', 'dividends');
  url.searchParams.set('tickers', tickers.slice(0, MAX_PER_REQUEST).join(','));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url.toString(), { method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'follow', signal: controller.signal });
    if (!response.ok) throw new DividendError('api', MESSAGES.api);
    let json;
    try {
      json = JSON.parse(await response.text());
    } catch {
      throw new DividendError('api', MESSAGES.api);
    }
    // 예전 시트 코드는 action을 몰라서 그냥 시세를 돌려준다
    if (!isPlainObject(json) || !isPlainObject(json.dividends)) {
      throw new DividendError(isPlainObject(json) && Object.hasOwn(json, 'prices') ? 'no-feature' : 'api', isPlainObject(json) && Object.hasOwn(json, 'prices') ? MESSAGES['no-feature'] : MESSAGES.api);
    }
    const dividends = {};
    for (const [ticker, info] of Object.entries(json.dividends)) {
      const perShare = Number(info?.perShare);
      if (!isPlainObject(info) || !Number.isFinite(perShare) || perShare < 0) continue;
      dividends[ticker] = { perShare, count: Number.isInteger(info.count) && info.count >= 0 ? info.count : 0, currency: typeof info.currency === 'string' ? info.currency : '' };
    }
    const list = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []);
    return { year: Number.isInteger(json.year) ? json.year : null, dividends, failed: list(json.failed), unsupported: list(json.unsupported) };
  } catch (error) {
    if (error instanceof DividendError) throw error;
    if (controller.signal.aborted) throw new DividendError('timeout', MESSAGES.timeout);
    throw new DividendError('network', MESSAGES.network);
  } finally {
    clearTimeout(timer);
  }
}

// ── 이 기기에 저장 ──
// { sheetUrl, year, data: { 티커: { perShare, count, currency, fetchedAt } }, failed: { 티커: 시각 } }
function emptyCache(sheetUrl, year) {
  return { sheetUrl, year, data: {}, failed: {} };
}

export function loadDividendCache(backend) {
  try {
    const raw = JSON.parse(backend.getItem(STORAGE_KEYS.dividendCache) ?? 'null');
    if (!isPlainObject(raw) || typeof raw.sheetUrl !== 'string' || !Number.isInteger(raw.year)) return null;
    const data = {};
    for (const [ticker, info] of Object.entries(isPlainObject(raw.data) ? raw.data : {})) {
      if (isPlainObject(info) && Number.isFinite(info.perShare) && info.perShare >= 0 && typeof info.fetchedAt === 'string') data[ticker] = info;
    }
    const failed = Object.fromEntries(Object.entries(isPlainObject(raw.failed) ? raw.failed : {}).filter(([, at]) => typeof at === 'string'));
    return { sheetUrl: raw.sheetUrl, year: raw.year, data, failed };
  } catch {
    return null;
  }
}

export function saveDividendCache(backend, cache) {
  backend.setItem(STORAGE_KEYS.dividendCache, JSON.stringify(cache));
}

// 받은 답을 저장해 둔 값에 합친다. 시트 주소나 '작년'이 바뀌었으면 처음부터.
export function mergeDividends(cache, sheetUrl, response, now = new Date()) {
  const year = response.year ?? lastYear(now);
  const next = cache && cache.sheetUrl === sheetUrl && cache.year === year
    ? { sheetUrl, year, data: { ...cache.data }, failed: { ...cache.failed } }
    : emptyCache(sheetUrl, year);
  const at = now.toISOString();
  for (const [ticker, info] of Object.entries(response.dividends)) {
    next.data[ticker] = { ...info, fetchedAt: at };
    delete next.failed[ticker];
  }
  for (const ticker of response.failed) {
    if (!next.data[ticker]) next.failed[ticker] = at;
  }
  return next;
}

// 새로 물어볼 티커: 저장해 둔 값이 없거나 일주일이 지났거나 작년이 바뀌었으면. 하루 안에 실패한 티커는 빼고.
export function dueDividendTickers(cache, sheetUrl, tickers, now = new Date()) {
  const fresh = cache && cache.sheetUrl === sheetUrl && cache.year === lastYear(now);
  return tickers.filter((ticker) => {
    if (!fresh) return true;
    const info = cache.data[ticker];
    if (info) return now - Date.parse(info.fetchedAt) > DIVIDEND_REFRESH_MS;
    const failedAt = Date.parse(cache.failed[ticker] ?? '');
    return !(now - failedAt < DIVIDEND_RETRY_MS);
  });
}

// 화면 계산에 쓰는 값: { 티커: { perShare, count, currency, year } } (지금 시트 주소의, 작년 것만)
export function dividendsFor(cache, sheetUrl, now = new Date()) {
  if (!cache || cache.sheetUrl !== sheetUrl || cache.year !== lastYear(now)) return {};
  return Object.fromEntries(Object.entries(cache.data).map(([ticker, info]) => [ticker, {
    perShare: info.perShare, count: info.count, currency: info.currency, year: cache.year,
  }]));
}

// 배당금 기준 안내 (valuePortfolio 결과로): '작년(2025년) 배당 기준 · 직접 적은 값 2종목'
export function dividendBasis(portfolio) {
  const { auto = 0, manual = 0, saved = 0 } = portfolio?.dividendSources ?? {};
  const parts = [];
  if (auto > 0) parts.push(`작년${portfolio.dividendYear ? `(${portfolio.dividendYear}년)` : ''} 배당 기준`);
  if (manual + saved > 0) parts.push(`직접 적은 값 ${manual + saved}종목`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export { MAX_PER_REQUEST as DIVIDEND_MAX_PER_REQUEST };
