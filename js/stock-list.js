// 종목 목록(data/stocks.json): 종목 입력 화면의 자동완성과 국가·섹터·자산군 자동 입력에 쓴다.
// 목록은 앱 파일과 함께 올라가 있어서, 검색할 때 바깥으로 아무것도 보내지 않는다.
// 목록은 scripts/build-stock-list.mjs가 만들고 GitHub Actions가 매달 새로 만든다.

import { guessCountry } from './classify.js';

const LIST_PATH = './data/stocks.json';

// 'KRX:005930' 같은 티커에서 거래소를 뺀 코드
const codeOf = (ticker) => String(ticker ?? '').split(':').pop();

// 비교용: 소문자로, 띄어쓰기와 기호는 빼고 ('S&P 500' → 'sp500')
export function normalizeQuery(text) {
  return String(text ?? '').toLowerCase().replace(/[\s·.,()\-_/&'"+]/g, '');
}

const mixOf = (value) => {
  if (value == null) return null;
  return typeof value === 'string' ? { [value]: 100 } : { ...value };
};

// 파일의 짧은 이름표를 화면에서 쓰는 이름으로 바꾼다
export function expandItem(raw) {
  return {
    ticker: raw.t,
    name: raw.n,
    aliases: raw.al ?? [],
    type: raw.k === 'e' ? 'etf' : 'stock',
    currency: raw.c,
    countryMix: mixOf(raw.co),
    // 다국가 지수 ETF면 국가 비중표 항목 이름 (계산할 때 지금 비중표 값을 쓴다)
    countryPreset: raw.cp ?? null,
    sectorMix: mixOf(raw.se),
    assetClass: raw.a ?? null,
    etfSpread: raw.k === 'e' ? raw.sp ?? null : null,
    approx: Boolean(raw.ax),
    group: raw.g ?? '',
    size: raw.sz ?? 0,
  };
}

let loading = null;

// 한 번만 받아 두고 다시 쓴다. 받지 못하면 다음에 다시 시도한다.
// 목록이 갱신되면 바로 쓰도록 브라우저에 저장된 사본을 그냥 쓰지 않고 서버에 바뀌었는지 확인한다 (안 바뀌었으면 짧은 응답).
export function loadStockList() {
  if (!loading) {
    loading = fetch(LIST_PATH, { cache: 'no-cache' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => (Array.isArray(data.items) ? data.items.map(expandItem) : []))
      .catch((error) => {
        loading = null;
        throw error;
      });
  }
  return loading;
}

// 국내 종목을 먼저 (같은 점수일 때)
const GROUP_ORDER = { kr: 0, 'kr-etf': 1, us: 2, 'us-etf': 3 };

// 종목명(한글 별칭 포함)이나 종목코드로 찾는다. 정확히 같은 코드·이름 → 앞부분이 같은 것 → 들어 있는 것 순서.
// 점수가 같으면 덩치(시가총액 자릿수)가 큰 것 → 국내 → 짧은 이름 순서 ('삼성' → 삼성전자가 삼성공조보다 먼저).
export function searchStocks(items, query, { limit = 8 } = {}) {
  const q = normalizeQuery(query);
  if (!q) return [];
  const scored = [];
  for (const item of items) {
    const code = codeOf(item.ticker).toLowerCase();
    const names = [item.name, ...item.aliases].map(normalizeQuery);
    let score = 0;
    if (code === q) score = 100;
    else if (names.includes(q)) score = 95;
    else if (names.some((name) => name.startsWith(q))) score = 80;
    else if (code.startsWith(q)) score = 60;
    else if (names.some((name) => name.includes(q))) score = 50;
    if (score > 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score
    || (b.item.size ?? 0) - (a.item.size ?? 0)
    || (GROUP_ORDER[a.item.group] ?? 9) - (GROUP_ORDER[b.item.group] ?? 9)
    || a.item.name.length - b.item.name.length
    || a.item.name.localeCompare(b.item.name));
  return scored.slice(0, limit).map((entry) => entry.item);
}

// 티커로 찾기 ('KRX:005930', 'NASDAQ:AAPL'). 거래소를 빼고 적어도 찾는다 ('005930', 'aapl').
export function findByTicker(items, ticker) {
  const wanted = String(ticker ?? '').trim().toUpperCase();
  if (!wanted) return null;
  const hasExchange = wanted.includes(':');
  return items.find((item) => (hasExchange ? item.ticker === wanted : codeOf(item.ticker) === wanted)) ?? null;
}

const isKoreaOnly = (mix) => Object.keys(mix ?? {}).length === 1 && mix.한국 === 100;

// 국가가 '한국'으로 저장됐지만 실제로는 다른 나라에 투자하는 ETF를 찾는다.
// (예전에는 KRX: 티커만 보고 한국으로 채웠다. 예: TIGER 미국S&P500) 종목 목록 값, 없으면 이름으로 짐작한 값으로 고친다.
// 돌려주는 값: [{ holding, countryMix, countryPreset }]
export function countryFixes(holdings, items) {
  const fixes = [];
  for (const holding of holdings ?? []) {
    if (holding.type !== 'etf' || holding.countryPreset || !isKoreaOnly(holding.countryMix)) continue;
    const listed = findByTicker(items ?? [], holding.ticker);
    const target = listed?.countryMix
      ? { countryMix: listed.countryMix, countryPreset: listed.countryPreset ?? null }
      : guessCountry({ name: holding.name, ticker: holding.ticker, type: 'etf' });
    if (!target?.countryMix || (!target.countryPreset && isKoreaOnly(target.countryMix))) continue;
    fixes.push({ holding, countryMix: target.countryMix, countryPreset: target.countryPreset ?? null });
  }
  return fixes;
}
