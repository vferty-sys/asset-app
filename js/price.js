// 구글 시트(Apps Script 웹 앱)에서 시세 받아오기, 응답 검사, 마지막 시세 캐시.
// 시세 요청은 사용자가 설정한 시트 주소로의 GET 하나다. 보유 종목의 티커(종목 코드)만 함께 보내서
// 시트에 없는 티커를 시트 코드가 알아서 넣게 하고, 수량·평단가·금액은 보내지 않는다. (기기 연동 요청은 sync.js)

import { STORAGE_KEYS } from './constants.js';
import { resolveFx } from './calc/valuation.js';
import { normalizeTicker } from './holding.js';
import { isPlainObject } from './validate.js';

export const FETCH_TIMEOUT_MS = 20000;
// 시트에서 달러 환율을 받는 줄 (Code.gs가 CURRENCY:로 시작하는 줄을 환율로 읽는다)
export const FX_TICKER = 'CURRENCY:USDKRW';
// 한 번에 시트에 넣어 달라고 보내는 티커 수 (Code.gs의 MAX_ADD_TICKERS와 같게)
export const SHEET_TICKER_LIMIT = 150;
// 시트 코드가 티커 자동 추가를 할 수 있는지 (응답의 features)
const ADD_TICKERS_FEATURE = 'add-tickers';

export class PriceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PriceError';
    this.code = code;
  }
}

const MESSAGES = {
  format: '시트에서 받은 내용이 예상과 달라요. Apps Script에 최신 Code.gs를 붙여넣고 다시 배포했는지 확인해 주세요.',
  notJson: '시트 주소의 응답을 읽지 못했어요. /exec로 끝나는 웹 앱 주소인지, 배포의 액세스 권한이 "모든 사용자"인지 확인해 주세요.',
  network: '시트에 연결하지 못했어요. 인터넷 연결, 시트 주소, 배포의 액세스 권한("모든 사용자")을 확인해 주세요.',
  timeout: '시트가 응답하지 않아요. 잠시 뒤 다시 시도해 주세요.',
};

function isPositive(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

// Apps Script 응답(요청서 4-2 형식)을 검사하고 정리한다.
// 가격이 숫자가 아니거나 0 이하인 티커는 errors로 옮긴다.
export function parseSheetResponse(json, { now = new Date() } = {}) {
  if (!isPlainObject(json)) throw new PriceError('format', MESSAGES.format);
  if (typeof json.error === 'string' && json.error) {
    throw new PriceError('script', `시트 코드에서 오류가 났어요: ${json.error}`);
  }
  if (!isPlainObject(json.prices)) throw new PriceError('format', MESSAGES.format);

  const prices = {};
  const errors = new Set();
  for (const [rawTicker, quote] of Object.entries(json.prices)) {
    const ticker = normalizeTicker(rawTicker);
    if (!ticker) continue;
    if (isPlainObject(quote) && isPositive(quote.price)) {
      const currency = typeof quote.currency === 'string' && quote.currency.trim() ? quote.currency.trim().toUpperCase() : null;
      prices[ticker] = { price: quote.price, currency };
    } else {
      errors.add(ticker);
    }
  }
  if (Array.isArray(json.errors)) {
    for (const value of json.errors) {
      const ticker = normalizeTicker(value);
      if (ticker && !Object.hasOwn(prices, ticker)) errors.add(ticker);
    }
  }

  const usdkrw = isPlainObject(json.fx) && isPositive(json.fx.USDKRW) ? json.fx.USDKRW : null;
  const updatedAt = typeof json.updatedAt === 'string' && !Number.isNaN(Date.parse(json.updatedAt))
    ? new Date(json.updatedAt).toISOString()
    : now.toISOString();
  // 이번 요청에서 시트 코드가 새로 넣은 티커. 예전 코드는 features가 없다 (저장해 둔 캐시는 canAddTickers로 읽는다)
  const added = Array.isArray(json.added) ? [...new Set(json.added.map(normalizeTicker).filter(Boolean))] : [];
  const canAddTickers = json.canAddTickers === true || (Array.isArray(json.features) && json.features.includes(ADD_TICKERS_FEATURE));
  // 아파트 실거래가: 시트 코드가 조회할 수 있는지, 인증키를 스크립트 속성에 넣었는지 (키 자체는 오지 않는다)
  const aptTrades = json.aptTrades === true || (Array.isArray(json.features) && json.features.includes('apt-trades'));
  const aptKey = json.aptKey === true;
  // 작년 배당금을 알려 줄 수 있는 시트 코드인지
  const dividendFeature = Array.isArray(json.features) && json.features.includes('dividends') || json.dividendFeature === true;
  // 전용면적별로 정확히 나눠 계산하는 시트 코드인지 (예전 코드는 ±1㎡ 비슷한 면적을 합쳐서 계산했다)
  const aptAreas = json.aptAreas === true || (Array.isArray(json.features) && json.features.includes('apt-areas'));
  return { updatedAt, fx: { USDKRW: usdkrw }, prices, errors: [...errors], added, canAddTickers, aptTrades, aptKey, aptAreas, dividendFeature };
}

// 시트에 넣어 달라고 보낼 티커: 보유 종목 티커(중복 없이) + 달러 종목이 있으면 환율 줄
export function sheetTickers(holdings) {
  const tickers = [];
  const add = (ticker) => {
    if (ticker && !tickers.includes(ticker)) tickers.push(ticker);
  };
  for (const holding of holdings ?? []) add(normalizeTicker(holding.ticker));
  if ((holdings ?? []).some((holding) => holding.currency === 'USD')) add(FX_TICKER);
  return tickers.slice(0, SHEET_TICKER_LIMIT);
}

// 시세 요청 주소: 웹 앱 주소 + ?tickers=KRX:005930,NASDAQ:QQQ
export function sheetRequestUrl(url, tickers = []) {
  if (!tickers.length) return url;
  const request = new URL(url);
  request.searchParams.set('tickers', tickers.join(','));
  return request.toString();
}

// 시트 주소로 GET 요청을 보내 시세를 받는다. 실패하면 사용자에게 보여줄 문구를 담은 PriceError를 던진다.
// tickers: 시트에 없으면 넣어 달라고 함께 보낼 티커 (sheetTickers)
export async function fetchSheetPrices(url, {
  tickers = [], fetchImpl = globalThis.fetch, timeoutMs = FETCH_TIMEOUT_MS, now = () => new Date(),
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(sheetRequestUrl(url, tickers), {
      method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'follow', signal: controller.signal,
    });
    if (!response.ok) {
      throw new PriceError('http', `시트 주소에서 오류가 났어요 (응답 코드 ${response.status}). 주소가 맞는지 확인해 주세요.`);
    }
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new PriceError('not-json', MESSAGES.notJson);
    }
    return parseSheetResponse(json, { now: now() });
  } catch (error) {
    if (error instanceof PriceError) throw error;
    if (controller.signal.aborted) throw new PriceError('timeout', MESSAGES.timeout);
    throw new PriceError('network', MESSAGES.network);
  } finally {
    clearTimeout(timer);
  }
}

// ── 마지막 시세 캐시 (앱 데이터와 따로 저장, 백업에는 넣지 않음) ──
// { sheetUrl, fetchedAt, data: parseSheetResponse 결과 }
export function loadPriceCache(backend) {
  try {
    const cache = JSON.parse(backend.getItem(STORAGE_KEYS.priceCache) ?? 'null');
    if (!isPlainObject(cache) || typeof cache.sheetUrl !== 'string' || !isPlainObject(cache.data)) return null;
    return {
      sheetUrl: cache.sheetUrl,
      fetchedAt: typeof cache.fetchedAt === 'string' ? cache.fetchedAt : null,
      data: parseSheetResponse(cache.data),
    };
  } catch {
    return null;
  }
}

export function savePriceCache(backend, cache) {
  backend.setItem(STORAGE_KEYS.priceCache, JSON.stringify(cache));
}

// 화면에서 쓰는 시세 정보. 시트 주소가 없으면 직접 입력 모드(mode: 'manual')다.
// 캐시는 지금 설정된 시트 주소에서 받은 것만 쓴다.
export function buildMarket({ cache, settings }) {
  const { sheetUrl } = settings;
  const data = sheetUrl && cache?.sheetUrl === sheetUrl ? cache.data : null;
  return {
    mode: sheetUrl ? 'sheet' : 'manual',
    hasData: Boolean(data),
    prices: data?.prices ?? {},
    errors: data?.errors ?? [],
    updatedAt: data?.updatedAt ?? null,
    fx: resolveFx({ sheetRate: data?.fx.USDKRW ?? null, manualRate: settings.manualFxUsdKrw }),
    // 시트 코드가 보유 종목 티커를 알아서 넣을 수 있는지 (최신 Code.gs)
    canAddTickers: Boolean(data?.canAddTickers),
    aptTrades: Boolean(data?.aptTrades),
    aptKey: Boolean(data?.aptKey),
    aptAreas: Boolean(data?.aptAreas),
    dividendFeature: Boolean(data?.dividendFeature),
  };
}

// 보유 종목 중 시트가 아직 모르는 티커 (가격도 오류도 없음). 환율 줄은 환율을 받았으면 아는 것으로 본다.
export function unknownSheetTickers(holdings, market) {
  if (market.mode !== 'sheet' || !market.hasData) return [];
  return sheetTickers(holdings).filter((ticker) => {
    if (ticker === FX_TICKER) return market.fx.source !== 'sheet' && !market.errors.includes(FX_TICKER);
    return !Object.hasOwn(market.prices, ticker) && !market.errors.includes(ticker);
  });
}

// 시트를 연결했는데 가격을 못 받은 종목을 찾는다.
//  notInSheet: 시트에 티커가 없음 / sheetErrors: 시트에 있지만 #N/A 등 오류 / currencyMismatch: 통화가 다름
export function findPriceIssues(holdings, market) {
  const issues = { notInSheet: [], sheetErrors: [], currencyMismatch: [] };
  if (market.mode !== 'sheet' || !market.hasData) return issues;
  const errorSet = new Set(market.errors);
  const add = (list, ticker) => { if (!list.includes(ticker)) list.push(ticker); };
  for (const holding of holdings) {
    const quote = Object.hasOwn(market.prices, holding.ticker) ? market.prices[holding.ticker] : null;
    if (quote) {
      if (quote.currency && quote.currency !== holding.currency) add(issues.currencyMismatch, holding.ticker);
    } else {
      add(errorSet.has(holding.ticker) ? issues.sheetErrors : issues.notInSheet, holding.ticker);
    }
  }
  return issues;
}
