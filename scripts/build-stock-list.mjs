// 종목 목록(data/stocks.json) 만들기 — 종목명 자동완성과 국가·섹터·자산군 자동 입력에 쓴다.
// 매달 GitHub Actions(.github/workflows/update-stock-list.yml)가 실행하고, 직접 실행해도 된다: npm run build:stocks
//
// 자료
//  - 국내 상장회사와 업종: 한국거래소 KIND 상장법인목록
//  - 국내 전 종목(우선주 포함)·ETF와 그 분류: 한국거래소 정보데이터시스템
//  - 미국: S&P500 구성 종목(GICS 섹터), 나스닥·NYSE 상장 목록(거래소 확인용) — GitHub의 공개 데이터셋
//  - 많이 사는 미국 ETF·종목과 한글 이름: scripts/stock-extras.mjs
// 어느 자료를 받지 못하면 그 부분은 지난 목록을 그대로 쓴다 (목록이 통째로 비지 않게).
// 프록시 뒤에서 실행할 때는 NODE_USE_ENV_PROXY=1 을 붙인다 (Node 22.21 이상).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDelimited } from '../js/calc/csv.js';
import { classifyEtf, sectorFromGics, sectorFromKrxIndustry, stockAssetClass } from '../js/classify.js';
import { US_ALIASES, US_ETFS, US_EXTRA_STOCKS } from './stock-extras.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'stocks.json');

const SOURCES = {
  kind: 'https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13',
  krx: 'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd',
  sp500: 'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv',
  nasdaq: 'https://raw.githubusercontent.com/datasets/nasdaq-listings/main/data/nasdaq-listed-symbols.csv',
  other: 'https://raw.githubusercontent.com/datasets/nyse-other-listings/main/data/other-listed.csv',
};
const KRX_REFERER = 'https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201';
const USER_AGENT = 'Mozilla/5.0 (compatible; asset-app stock list builder)';
const US_EXCHANGES = { N: 'NYSE', A: 'NYSEAMERICAN', P: 'NYSEARCA', Z: 'BATS' };

async function request(url, { method = 'GET', body = undefined, headers = {}, encoding = 'utf-8' } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method, body, headers: { 'User-Agent': USER_AGENT, ...headers }, signal: AbortSignal.timeout(30_000),
      });
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

function decodeHtml(text) {
  return text
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .trim();
}

// 비율이 하나뿐이면 이름만, 여러 개면 { 이름: 비율 }, 모르면 null (파일을 작게)
const compactMix = (mix) => {
  if (!mix) return null;
  const names = Object.keys(mix);
  return names.length === 1 && mix[names[0]] === 100 ? names[0] : mix;
};

function etfItem({ ticker, name, aliases = [], currency, group, meta }) {
  const result = classifyEtf(name, { ...meta, ticker });
  return {
    t: ticker, n: name, ...(aliases.length ? { al: aliases } : {}), k: 'e', c: currency,
    co: compactMix(result.countryMix), se: compactMix(result.sectorMix), a: result.assetClass, sp: result.spread,
    ...(result.approx ? { ax: 1 } : {}), g: group,
  };
}

// ── 국내 ─────────────────────────────────────────────
// KIND 상장법인목록: 회사명·시장구분·종목코드·업종 (EUC-KR로 된 HTML 표)
async function kindCompanies() {
  const html = await request(SOURCES.kind, { encoding: 'euc-kr' });
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((row) => [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => decodeHtml(cell[1].replace(/<[^>]+>/g, ''))));
  const [header, ...body] = rows;
  const column = (label) => header.findIndex((cell) => cell.includes(label));
  const [iName, iMarket, iCode, iIndustry] = ['회사명', '시장구분', '종목코드', '업종'].map(column);
  if ([iName, iMarket, iCode, iIndustry].some((index) => index < 0)) throw new Error('KIND 상장법인목록의 표 모양이 바뀌었어요');
  return body
    .filter((cells) => cells.length > iIndustry && cells[iCode])
    .map((cells) => ({
      name: cells[iName],
      market: cells[iMarket],
      code: /^\d+$/.test(cells[iCode]) ? cells[iCode].padStart(6, '0') : cells[iCode],
      industry: cells[iIndustry],
    }));
}

async function krxTable(bld, params) {
  const text = await request(SOURCES.krx, {
    method: 'POST',
    body: new URLSearchParams({ bld, locale: 'ko_KR', csvxls_isNo: 'false', ...params }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Referer: KRX_REFERER, 'X-Requested-With': 'XMLHttpRequest' },
  });
  const json = JSON.parse(text);
  const rows = json.OutBlock_1 ?? json.output ?? json.block1;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${bld}: 빈 응답`);
  return rows;
}

const PREFIX = { 유가: 'KRX', 유가증권: 'KRX', KOSPI: 'KRX', 코스닥: 'KOSDAQ', KOSDAQ: 'KOSDAQ' };

// '삼성전자우', '현대차2우B', 'LG화학우' → 본 회사 이름
const commonName = (name) => name.replace(/\s*\(전환\)$/, '').replace(/\d?우[A-C]?$/, '').trim();

async function krStocks() {
  const companies = await kindCompanies();
  const byCode = new Map(companies.map((company) => [company.code, company]));
  const byName = new Map(companies.map((company) => [company.name, company]));
  const items = new Map();
  const add = (code, name, market, industry) => {
    const prefix = PREFIX[market];
    if (!prefix) return; // 코넥스 등은 구글 시세가 없어 뺀다
    const sector = sectorFromKrxIndustry(industry);
    items.set(code, {
      t: `${prefix}:${code}`, n: name, k: 's', c: 'KRW', co: '한국', se: sector,
      a: stockAssetClass({ name, sector, detail: industry }), g: 'kr',
    });
  };
  for (const company of companies) add(company.code, company.name, company.market, company.industry);

  // 우선주처럼 KIND 목록에 따로 없는 주식 (받지 못해도 보통주 목록은 쓴다)
  try {
    const securities = await krxTable('dbms/MDC/STAT/standard/MDCSTAT01901', { mktId: 'ALL', share: '1' });
    for (const row of securities) {
      const code = row.ISU_SRT_CD;
      if (!code || items.has(code) || !/주권|주식/.test(row.SECUGRP_NM ?? '주권')) continue;
      const parent = byCode.get(code) ?? byName.get(commonName(row.ISU_ABBRV));
      add(code, row.ISU_ABBRV, row.MKT_TP_NM, parent?.industry ?? '');
    }
  } catch (error) {
    console.warn(`  · 우선주 목록을 받지 못해 보통주만 넣어요: ${error.message}`);
  }
  return [...items.values()];
}

async function krEtfs() {
  const rows = await krxTable('dbms/MDC/STAT/standard/MDCSTAT04601', { share: '1' });
  return rows
    .filter((row) => row.ISU_SRT_CD && row.ISU_ABBRV)
    .map((row) => etfItem({
      ticker: `KRX:${row.ISU_SRT_CD}`,
      name: row.ISU_ABBRV,
      currency: 'KRW',
      group: 'kr-etf',
      meta: { market: row.IDX_MKT_CLSS_NM, assetType: row.IDX_ASST_CLSS_NM, index: row.ETF_OBJ_IDX_NM ?? '' },
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
