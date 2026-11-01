// 종목 목록(data/stocks.json) 만들기 — 종목명 자동완성과 국가·섹터·자산군 자동 입력에 쓴다.
// 매달 GitHub Actions(.github/workflows/update-stock-list.yml)가 실행하고, 직접 실행해도 된다: npm run build:stocks
//
// 자료
//  - 국내 주식(우선주 포함)과 업종, 코스피·코스닥 구분: 네이버 금융 업종별 시세
//  - 국내 ETF와 그 분류(시장지수·업종테마·파생·해외·원자재·채권·기타): 네이버 금융 ETF 목록
//    (한국거래소 KIND는 해외 서버 접속을 막고, 정보데이터시스템은 로그인이 있어야 자료를 줘서 쓰지 않는다)
//  - 미국: S&P500 구성 종목(GICS 섹터), 나스닥·NYSE 상장 목록(거래소 확인용) — GitHub의 공개 데이터셋
//  - 많이 사는 미국 ETF·종목과 한글 이름: scripts/stock-extras.mjs
// 어느 자료를 받지 못하면 그 부분은 지난 목록을 그대로 쓴다 (목록이 통째로 비지 않게).
// 프록시 뒤에서 실행할 때는 NODE_USE_ENV_PROXY=1 을 붙인다 (Node 22.21 이상).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDelimited } from '../js/calc/csv.js';
import { classifyEtf, sectorFromGics, sectorFromKrIndustry, stockAssetClass } from '../js/classify.js';
import { US_ALIASES, US_ETFS, US_EXTRA_STOCKS } from './stock-extras.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'stocks.json');

const SOURCES = {
  industries: 'https://m.stock.naver.com/api/stocks/industry',
  etfs: 'https://finance.naver.com/api/sise/etfItemList.nhn?etfType=0&targetColumn=market_sum&sortOrder=desc',
  sp500: 'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv',
  nasdaq: 'https://raw.githubusercontent.com/datasets/nasdaq-listings/main/data/nasdaq-listed-symbols.csv',
  other: 'https://raw.githubusercontent.com/datasets/nyse-other-listings/main/data/other-listed.csv',
};
const USER_AGENT = 'Mozilla/5.0 (compatible; asset-app stock list builder)';
const US_EXCHANGES = { N: 'NYSE', A: 'NYSEAMERICAN', P: 'NYSEARCA', Z: 'BATS' };
// 한 번에 다 받으면 자료를 주는 쪽에 부담이라 요청 사이를 조금 띄운다
const PAUSE_MS = 150;
const pause = () => new Promise((resolve) => setTimeout(resolve, PAUSE_MS));

async function request(url, { headers = {}, encoding = 'utf-8' } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return new TextDecoder(encoding).decode(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  throw new Error(`${url} — ${lastError?.message ?? lastError}`);
}

// 제목 줄이 있는 CSV → 객체 목록
async function csvRecords(url) {
  const [header, ...rows] = parseDelimited(await request(url));
  return rows.map(({ cells }) => Object.fromEntries(header.cells.map((name, index) => [name.trim(), (cells[index] ?? '').trim()])));
}

// 비율이 하나뿐이면 이름만, 여러 개면 { 이름: 비율 }, 모르면 null (파일을 작게)
const compactMix = (mix) => {
  if (!mix) return null;
  const names = Object.keys(mix);
  return names.length === 1 && mix[names[0]] === 100 ? names[0] : mix;
};

// 시가총액(억원)의 자릿수: 검색에서 점수가 같을 때 큰 종목을 먼저 보여 주는 데 쓴다.
// 정확한 금액 대신 자릿수만 적어 두어 매달 갱신해도 거의 바뀌지 않는다. (삼성전자 약 1,000조원 → 7)
function sizeTier(value) {
  const amount = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(amount) && amount >= 1 ? Math.floor(Math.log10(amount)) : 0;
}
const sizeField = (value) => {
  const tier = sizeTier(value);
  return tier > 0 ? { sz: tier } : {};
};

function etfItem({ ticker, name, aliases = [], currency, group, meta, marketCap = null }) {
  const result = classifyEtf(name, { ...meta, ticker });
  return {
    t: ticker, n: name, ...(aliases.length ? { al: aliases } : {}), k: 'e', c: currency,
    // cp: 국가 비중표 항목 (다국가 지수 ETF). 앱은 이 항목의 지금 비중으로 계산하고, co는 만들 때의 비중(참고용)
    co: compactMix(result.countryMix), ...(result.countryPreset ? { cp: result.countryPreset } : {}),
    se: compactMix(result.sectorMix), a: result.assetClass, sp: result.spread,
    ...(result.approx ? { ax: 1 } : {}), ...sizeField(marketCap), g: group,
  };
}

// ── 국내 ─────────────────────────────────────────────
// 받은 개수가 이보다 적으면 자료 모양이 바뀐 것으로 보고 지난 목록을 쓴다 (2026년 기준 주식 약 2,800개, ETF 약 1,200개)
const KR_MIN_STOCKS = 2000;
const KR_MIN_ETFS = 600;
// 코스피는 KRX:, 코스닥은 KOSDAQ: (코넥스는 구글 시세가 없어 뺀다)
const KR_PREFIX = { KOSPI: 'KRX', KOSDAQ: 'KOSDAQ' };
// '기타' 업종 묶음에는 ETF·ETN만 들어 있어 주식 목록에서는 건너뛴다 (ETF는 따로 받는다)
const SKIP_INDUSTRIES = ['기타'];

async function naverJson(url) {
  const json = JSON.parse(await request(url));
  await pause();
  return json;
}

// 네이버 금융 업종 목록과 업종마다 속한 종목 (한 번에 100개씩)
async function krStocks() {
  const { groups } = await naverJson(`${SOURCES.industries}?page=1&pageSize=100`);
  if (!Array.isArray(groups) || groups.length === 0) throw new Error('업종 목록이 비어 있어요');
  const items = new Map();
  for (const group of groups) {
    if (SKIP_INDUSTRIES.includes(group.name)) continue;
    const sector = sectorFromKrIndustry(group.name);
    for (let page = 1; ; page += 1) {
      const { stocks = [] } = await naverJson(`${SOURCES.industries}/${group.no}?page=${page}&pageSize=100`);
      for (const stock of stocks) {
        const prefix = KR_PREFIX[stock.stockExchangeType?.name];
        if (stock.stockEndType !== 'stock' || !prefix || !stock.itemCode || !stock.stockName) continue;
        items.set(stock.itemCode, {
          t: `${prefix}:${stock.itemCode}`, n: stock.stockName, k: 's', c: 'KRW', co: '한국', se: sector,
          a: stockAssetClass({ name: stock.stockName, sector, detail: group.name }), ...sizeField(stock.marketValue), g: 'kr',
        });
      }
      if (stocks.length < 100) break;
    }
  }
  if (items.size < KR_MIN_STOCKS) throw new Error(`국내 주식이 ${items.size}개뿐이에요 (자료 모양이 바뀌었을 수 있어요)`);
  return [...items.values()];
}

// 네이버 금융 ETF 분류 번호 → classifyEtf에 넘길 정보
const NAVER_ETF_TABS = {
  1: { market: '국내', broadIndex: true }, // 국내 시장지수 (코스피200, 코스닥150, MSCI Korea …)
  2: { market: '국내' }, // 국내 업종·테마
  3: { market: '국내', broadIndex: true }, // 국내 파생 (대부분 코스피200·코스닥150의 레버리지·인버스·커버드콜)
  4: { market: '해외' }, // 해외 주식
  5: { assetType: '원자재' }, // 금·은·원유 …
  6: { assetType: '채권', fallbackCountry: '한국' }, // 채권 (이름에 나라가 없으면 국내 채권)
  7: {}, // 기타 (머니마켓, TDF, 혼합 …)
};

async function krEtfs() {
  const json = JSON.parse(await request(SOURCES.etfs, { encoding: 'euc-kr' }));
  const rows = json?.result?.etfItemList;
  if (!Array.isArray(rows) || rows.length < KR_MIN_ETFS) throw new Error(`ETF가 ${rows?.length ?? 0}개뿐이에요 (자료 모양이 바뀌었을 수 있어요)`);
  return rows
    .filter((row) => row.itemcode && row.itemname)
    .map((row) => etfItem({
      ticker: `KRX:${row.itemcode}`,
      name: row.itemname.trim(),
      currency: 'KRW',
      group: 'kr-etf',
      meta: NAVER_ETF_TABS[row.etfTabCode] ?? {},
      marketCap: row.marketSum,
    }));
}

// ── 미국 ─────────────────────────────────────────────
async function usExchanges() {
  const [nasdaq, other] = await Promise.all([csvRecords(SOURCES.nasdaq), csvRecords(SOURCES.other)]);
  const map = new Map();
  const key = (symbol) => symbol.toUpperCase().replace(/[\s/$-]/g, '.');
  for (const row of nasdaq) if (row.Symbol) map.set(key(row.Symbol), 'NASDAQ');
  for (const row of other) {
    const exchange = US_EXCHANGES[row.Exchange];
    if (row['ACT Symbol'] && exchange) map.set(key(row['ACT Symbol']), exchange);
  }
  return (symbol) => {
    const exchange = map.get(key(symbol));
    return exchange ? `${exchange}:${symbol}` : symbol;
  };
}

async function usStocks(tickerOf) {
  const rows = await csvRecords(SOURCES.sp500);
  const items = rows.filter((row) => row.Symbol && row.Security).map((row) => {
    const sector = sectorFromGics(row['GICS Sector']);
    const aliases = US_ALIASES[row.Symbol] ?? [];
    return {
      t: tickerOf(row.Symbol), n: row.Security, ...(aliases.length ? { al: aliases } : {}), k: 's', c: 'USD', co: '미국', se: sector,
      a: stockAssetClass({ name: row.Security, sector, detail: row['GICS Sub-Industry'] }), g: 'us',
    };
  });
  const listed = new Set(items.map((item) => item.t.split(':').pop()));
  for (const [symbol, name, aliases, sector, country] of US_EXTRA_STOCKS) {
    if (listed.has(symbol)) continue;
    items.push({
      t: tickerOf(symbol), n: name, ...(aliases.length ? { al: aliases } : {}), k: 's', c: 'USD', co: country, se: sector,
      a: stockAssetClass({ name, sector }), g: 'us',
    });
  }
  return items;
}

function usEtfs(tickerOf) {
  return US_ETFS.map(([symbol, name, aliases, hint]) => etfItem({
    ticker: tickerOf(symbol), name, aliases, currency: 'USD', group: 'us-etf', meta: { index: hint },
  }));
}

// ── 만들기 ─────────────────────────────────────────────
async function previousList() {
  try {
    const data = JSON.parse(await readFile(OUT, 'utf8'));
    return { items: data.items ?? [], dates: data.dates ?? {} };
  } catch {
    return { items: [], dates: {} };
  }
}

async function main() {
  const previous = await previousList();
  const today = new Date().toISOString().slice(0, 10);
  const groups = {};
  const dates = {}; // 부분마다 마지막으로 새로 받은 날 (받지 못하면 지난 날짜를 그대로)
  const failed = [];
  const build = async (group, label, make) => {
    try {
      groups[group] = await make();
      dates[group] = today;
      console.log(`  ✓ ${label}: ${groups[group].length}개`);
    } catch (error) {
      groups[group] = previous.items.filter((item) => item.g === group);
      dates[group] = previous.dates[group] ?? null;
      failed.push(label);
      console.warn(`  ✗ ${label}: ${error.message} → 지난 목록 ${groups[group].length}개를 그대로 써요`);
    }
  };

  console.log('종목 목록 만드는 중…');
  await build('kr', '국내 주식', krStocks);
  await build('kr-etf', '국내 ETF', krEtfs);
  let tickerOf = (symbol) => symbol;
  try {
    tickerOf = await usExchanges();
  } catch (error) {
    console.warn(`  · 미국 거래소 목록을 받지 못해 티커에 거래소를 붙이지 못해요: ${error.message}`);
  }
  await build('us', '미국 주식', () => usStocks(tickerOf));
  await build('us-etf', '미국 ETF', () => usEtfs(tickerOf));

  const items = Object.values(groups).flat().sort((a, b) => (a.g === b.g ? a.t.localeCompare(b.t) : 0));
  if (items.length === 0) throw new Error('받은 종목이 하나도 없어요');
  const counts = Object.fromEntries(Object.entries(groups).map(([group, list]) => [group, list.length]));
  const header = { version: 1, dates, counts };
  // 한 줄에 한 종목: 다음 갱신 때 바뀐 종목만 차이로 보이게
  const text = `${JSON.stringify(header).slice(0, -1)},"items":[\n${items.map((item) => JSON.stringify(item)).join(',\n')}\n]}\n`;
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, text);
  console.log(`저장: data/stocks.json (${items.length}개, ${Math.round(text.length / 1024)}KB)${failed.length ? ` — 지난 목록을 쓴 부분: ${failed.join(', ')}` : ''}`);
}

main().catch((error) => {
  console.error(`종목 목록을 만들지 못했어요: ${error.message}`);
  process.exit(1);
});
