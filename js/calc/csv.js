// CSV 붙여넣기로 보유 종목 일괄 등록.
// 엑셀·구글 시트에서 표를 복사하면 탭(\t)으로, 직접 적으면 쉼표(,)로 구분된다. 둘 다 받는다.

import { ACCOUNTS, ASSET_CLASSES } from '../constants.js';
import { guessFromTicker, holdingKey, holdingToInput, normalizeTicker, validateHolding } from '../holding.js';

// 텍스트를 줄·칸으로 나눈다. 큰따옴표로 감싼 칸 안의 쉼표·줄바꿈과 "" (따옴표 자체)를 처리한다.
// 돌려주는 값: [{ line: 시작 줄 번호, cells: [...] }] (빈 줄은 뺀다)
export function parseDelimited(text) {
  const source = String(text ?? '').replace(/^﻿/, '');
  const firstLine = source.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
  const delimiter = firstLine.includes('\t') ? '\t' : ',';

  const rows = [];
  let cells = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const endRow = () => {
    cells.push(cell);
    rows.push({ line: rowLine, cells });
    cells = [];
    cell = '';
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        if (ch === '\n') line += 1;
        cell += ch;
      }
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      endRow();
      line += 1;
      rowLine = line;
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || cells.length > 0) endRow();

  return rows
    .map((row) => ({ line: row.line, cells: row.cells.map((value) => value.trim()) }))
    .filter((row) => row.cells.some((value) => value !== ''));
}

export const HOLDING_CSV_COLUMNS = Object.freeze([
  { key: 'name', label: '종목명', aliases: ['종목', '이름', 'name'], required: true },
  { key: 'ticker', label: '티커', aliases: ['종목코드', 'ticker', 'symbol'], required: true },
  { key: 'quantity', label: '수량', aliases: ['보유수량', 'quantity', 'qty'], required: true },
  { key: 'avgPrice', label: '평단가', aliases: ['평균단가', '매입단가', 'avgprice'], required: true },
  { key: 'type', label: '종류', aliases: ['유형', 'type'] },
  { key: 'currency', label: '통화', aliases: ['currency'] },
  { key: 'account', label: '계좌', aliases: ['account'] },
  { key: 'assetClass', label: '자산군', aliases: ['assetclass'] },
  { key: 'country', label: '국가', aliases: ['country'] },
  { key: 'sector', label: '섹터', aliases: ['sector'] },
  { key: 'manualPrice', label: '현재가', aliases: ['manualprice', 'price'] },
  { key: 'dividendPerShare', label: '주당배당금', aliases: ['배당금', '연간주당배당금', 'dividend', 'dividendpershare'] },
  { key: 'memo', label: '메모', aliases: ['memo', 'note'] },
]);

export const HOLDING_CSV_TEMPLATE = [
  '종목명,티커,종류,통화,수량,평단가,계좌,자산군,국가,섹터',
  '삼성전자,KRX:005930,주식,KRW,10,61000,일반,성장주,한국,기술',
  'QQQ,NASDAQ:QQQ,ETF,USD,3,450,일반,성장주,미국,기술:50;통신:15;소비재:35',
].join('\n');

function headerKey(cell) {
  const normalized = cell.toLowerCase().replace(/\(.*?\)/g, '').replace(/[\s_-]/g, '');
  const column = HOLDING_CSV_COLUMNS.find(
    (col) => col.label === normalized || col.aliases.includes(normalized) || col.key.toLowerCase() === normalized,
  );
  return column ? column.key : null;
}

const TYPE_ALIASES = { 주식: 'stock', 개별주식: 'stock', stock: 'stock', etf: 'etf' };
const CURRENCY_ALIASES = { krw: 'KRW', 원: 'KRW', 원화: 'KRW', '₩': 'KRW', usd: 'USD', 달러: 'USD', $: 'USD' };

function mapAlias(cell, aliases) {
  const key = cell.toLowerCase().replace(/\s/g, '');
  return Object.hasOwn(aliases, key) ? aliases[key] : cell;
}

function cleanNumberCell(cell) {
  return cell.replace(/[₩$원주]|달러/g, '').trim();
}

// "미국" → [{미국, 100}], "기술:50;통신:15" → 나눠서
export function parseMixCell(cell) {
  const parts = cell.split(/[;|]/).map((part) => part.trim()).filter(Boolean);
  return parts.map((part) => {
    const match = /^(.+?)\s*[:=]\s*([\d.,]+)\s*%?$/.exec(part);
    if (match) return { name: match[1].trim(), percent: match[2] };
    return { name: part, percent: parts.length === 1 ? '100' : '' };
  });
}

const ENUM_MESSAGES = {
  type: '종류는 "주식" 또는 "ETF"로 적어 주세요.',
  currency: '통화는 KRW 또는 USD로 적어 주세요.',
  account: `계좌는 ${ACCOUNTS.join(' / ')} 중 하나로 적어 주세요.`,
  assetClass: `자산군은 ${ASSET_CLASSES.join(' / ')} 중 하나로 적어 주세요.`,
};
const FIELD_LABELS = {
  ...Object.fromEntries(HOLDING_CSV_COLUMNS.map((col) => [col.key, col.label])),
  countryMix: '국가',
  sectorMix: '섹터',
};

function rowMessages(errors) {
  return Object.entries(errors).map(([key, message]) => ENUM_MESSAGES[key] ?? `${FIELD_LABELS[key] ?? key}: ${message}`);
}

function newInput(ticker) {
  const guess = guessFromTicker(ticker);
  return {
    name: '',
    ticker,
    type: 'stock',
    currency: guess?.currency ?? '',
    quantity: '',
    avgPrice: '',
    manualPrice: '',
    account: '일반',
    assetClass: '기타',
    countryRows: [{ name: guess?.country ?? '기타', percent: '100' }],
    sectorRows: [{ name: '기타', percent: '100' }],
    dividendPerShare: '',
    memo: '',
  };
}

// 붙여넣은 내용을 검사해서 줄마다 결과를 돌려준다.
// status: 'add'(새로 등록) | 'update'(같은 계좌의 기존 종목 덮어쓰기) | 'skip'(이미 있어 건너뜀) | 'error'
// 덮어쓸 때는 붙여넣은 열의 값만 바꾸고, 없는 열은 기존 값을 그대로 둔다.
export function parseHoldingsCsv(text, { existing = [], allowFractionalUS = false, overwrite = false } = {}) {
  const table = parseDelimited(text);
  if (table.length === 0) return { error: '붙여넣은 내용이 없어요.', rows: [] };

  const [header, ...body] = table;
  const columns = header.cells.map(headerKey);
  const missing = HOLDING_CSV_COLUMNS.filter((col) => col.required && !columns.includes(col.key));
  if (missing.length > 0) {
    return { error: `첫 줄(제목 줄)에 꼭 필요한 열이 없어요: ${missing.map((col) => col.label).join(', ')}`, rows: [] };
  }
  if (body.length === 0) return { error: '제목 줄 아래에 종목을 한 줄 이상 적어 주세요.', rows: [] };

  const existingByKey = new Map(existing.map((holding) => [holdingKey(holding), holding]));
  const seenLines = new Map();

  const rows = body.map(({ line, cells }) => {
    const record = {};
    columns.forEach((key, index) => {
      if (key && !Object.hasOwn(record, key)) record[key] = cells[index] ?? '';
    });
    const ticker = normalizeTicker(record.ticker);
    const account = record.account || '일반';
    const key = holdingKey({ ticker, account });
    const base = { line, name: record.name ?? '', ticker };

    if (ticker && seenLines.has(key)) {
      return { ...base, status: 'error', messages: [`${seenLines.get(key)}번째 줄과 같은 종목·계좌가 겹쳐요.`] };
    }
    if (ticker) seenLines.set(key, line);

    const current = existingByKey.get(key);
    if (current && !overwrite) {
      return { ...base, status: 'skip', messages: ['같은 계좌에 이미 있는 종목이라 건너뛰어요.'] };
    }

    const input = current ? holdingToInput(current) : newInput(ticker);
    const has = (column) => Object.hasOwn(record, column);
    const filled = (column) => has(column) && record[column] !== '';

    input.name = record.name;
    input.ticker = ticker;
    input.quantity = cleanNumberCell(record.quantity);
    input.avgPrice = cleanNumberCell(record.avgPrice);
    if (filled('type')) input.type = mapAlias(record.type, TYPE_ALIASES);
    if (filled('currency')) input.currency = mapAlias(record.currency, CURRENCY_ALIASES);
    if (filled('account')) input.account = record.account;
    if (filled('assetClass')) input.assetClass = record.assetClass;
    if (filled('country')) input.countryRows = parseMixCell(record.country);
    if (filled('sector')) input.sectorRows = parseMixCell(record.sector);
    if (has('manualPrice')) input.manualPrice = cleanNumberCell(record.manualPrice);
    if (has('dividendPerShare')) input.dividendPerShare = cleanNumberCell(record.dividendPerShare);
    if (has('memo')) input.memo = record.memo;

    const result = validateHolding(input, { allowFractionalUS, existing });
    if (!result.ok) return { ...base, status: 'error', messages: rowMessages(result.errors) };
    return {
      ...base,
      status: current ? 'update' : 'add',
      holding: result.value,
      messages: Object.values(result.warnings),
    };
  });

  return { rows };
}
