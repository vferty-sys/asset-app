// 종목 목록(data/stocks.json): 종목 입력 화면의 자동완성과 국가·섹터·자산군 자동 입력에 쓴다.
// 목록은 앱 파일과 함께 올라가 있어서, 검색할 때 바깥으로 아무것도 보내지 않는다.
// 목록은 scripts/build-stock-list.mjs가 만들고 GitHub Actions가 매달 새로 만든다.

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
    sectorMix: mixOf(raw.se),
    assetClass: raw.a ?? null,
    etfSpread: raw.k === 'e' ? raw.sp ?? null : null,
    approx: Boolean(raw.ax),
    group: raw.g ?? '',
  };
}

let loading = null;

// 한 번만 받아 두고 다시 쓴다. 받지 못하면 다음에 다시 시도한다.
export function loadStockList() {
  if (!loading) {
    loading = fetch(LIST_PATH)
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
