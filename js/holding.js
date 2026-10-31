// 보유 종목 데이터의 정리와 입력 검증. 입력 화면, CSV 붙여넣기, 저장 데이터 정리에서 함께 쓴다.

import { ACCOUNTS, ASSET_CLASSES, CURRENCIES, ETF_SPREADS, HOLDING_TYPES } from './constants.js';
import { coerceValue, isPlainObject, parseNumberInput, sanitizeObject } from './validate.js';
import { createId } from './id.js';

const KRW_EXCHANGES = ['KRX', 'KOSDAQ'];
const USD_EXCHANGES = ['NASDAQ', 'NYSE', 'NYSEARCA', 'NYSEAMERICAN', 'BATS', 'AMEX'];
const TICKER_PATTERN = /^[A-Z0-9._-]+(:[A-Z0-9._-]+)?$/;

export function normalizeTicker(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

// 거래소 접두어로 통화와 국가를 짐작한다. 모르면 null.
export function guessFromTicker(ticker) {
  const [exchange, symbol] = normalizeTicker(ticker).split(':');
  if (!symbol) return null;
  if (KRW_EXCHANGES.includes(exchange)) return { currency: 'KRW', country: '한국' };
  if (USD_EXCHANGES.includes(exchange)) return { currency: 'USD', country: '미국' };
  return null;
}

// ETF 이름·티커로 분산 정도를 짐작한다 (입력 화면에서 바꿀 수 있다).
//  집중형: 레버리지·인버스·단일 종목 / 시장 전체형: S&P500·나스닥100·코스피200·전세계 같은 시장 지수 / 그 밖: 업종·테마형
const SINGLE_NAME = /레버리지|인버스|곱버스|단일\s*종목|싱글|\b[23]X\b|ULTRA/i;
const MARKET_NAMES = [
  /S&P\s*500|\bSP\s*500/i,
  /나스닥\s*100|NASDAQ[\s-]*100/i,
  /(코스피|KOSPI)\s*(200|100|50)?\s*(TR)?\s*$/i,
  /^\S+\s+200\s*(TR)?$/i,
  /코스닥\s*150|KOSDAQ\s*150/i,
  /전세계|올\s*월드|ALL[\s-]*WORLD|MSCI|ACWI|토탈\s*마켓|TOTAL\s*(MARKET|STOCK)|선진국|신흥국/i,
];
const SINGLE_TICKERS = ['TQQQ', 'SQQQ', 'SOXL', 'SOXS', 'UPRO', 'SPXU', 'SPXL', 'SSO', 'QLD', 'TECL', 'TNA', 'FNGU', 'TSLL', 'NVDL'];
const MARKET_TICKERS = [
  'SPY', 'VOO', 'IVV', 'SPLG', 'RSP', 'VTI', 'ITOT', 'SCHB', 'SCHX', 'SPTM', 'QQQ', 'QQQM', 'DIA', 'IWM', 'IWB', 'IWV',
  'VT', 'VXUS', 'VEA', 'VWO', 'IEFA', 'IEMG', 'EFA', 'EEM', 'ACWI', 'URTH',
];

export function guessEtfSpread({ name = '', ticker = '' } = {}) {
  const symbol = normalizeTicker(ticker).split(':').pop();
  const title = String(name).trim();
  if (SINGLE_NAME.test(title) || SINGLE_TICKERS.includes(symbol)) return 'single';
  if (MARKET_NAMES.some((pattern) => pattern.test(title)) || MARKET_TICKERS.includes(symbol)) return 'market';
  return 'theme';
}

// 같은 계좌의 같은 종목은 하나만 둔다.
export function holdingKey({ ticker, account }) {
  return `${normalizeTicker(ticker)}|${account}`;
}

export function mixSum(mix) {
  return Object.values(mix ?? {}).reduce((sum, value) => sum + value, 0);
}

export function isMixComplete(mix) {
  return Math.abs(mixSum(mix) - 100) < 0.01;
}

export function mixToRows(mix) {
  return Object.entries(mix ?? {}).map(([name, percent]) => ({ name, percent }));
}

function cleanMix(value) {
  if (!isPlainObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([name, percent]) => [String(name).trim(), percent])
      .filter(([name, percent]) => name && typeof percent === 'number' && Number.isFinite(percent) && percent > 0),
  );
}

const STORED_FIELDS = {
  name: { type: 'string', default: '' },
  type: { type: 'enum', options: HOLDING_TYPES, default: 'stock' },
  currency: { type: 'enum', options: CURRENCIES, default: 'KRW' },
  quantity: { type: 'number', min: 0, default: 0 },
  avgPrice: { type: 'number', min: 0, default: 0 },
  manualPrice: { type: 'number', nullable: true, exclusiveMin: 0, default: null },
  account: { type: 'enum', options: ACCOUNTS, default: '일반' },
  assetClass: { type: 'enum', options: ASSET_CLASSES, default: '기타' },
  dividendPerShare: { type: 'number', nullable: true, min: 0, default: null },
  etfSpread: { type: 'enum', options: ETF_SPREADS, nullable: true, default: null },
  memo: { type: 'string', default: '' },
};

// ETF만 분산 정도를 가진다. 고르지 않았으면(예전 데이터 포함) 이름·티커로 짐작한다.
function spreadFor(type, spread, name, ticker) {
  if (type !== 'etf') return null;
  return spread ?? guessEtfSpread({ name, ticker });
}

// 저장된(또는 복원한) 종목을 현재 구조로 맞춘다. 형식이 틀린 값은 기본값으로 바꾼다.
export function normalizeHolding(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const fields = sanitizeObject(STORED_FIELDS, source);
  const ticker = normalizeTicker(source.ticker);
  return {
    id: typeof source.id === 'string' && source.id ? source.id : createId('h'),
    name: fields.name,
    ticker,
    type: fields.type,
    etfSpread: spreadFor(fields.type, fields.etfSpread, fields.name, ticker),
    currency: fields.currency,
    quantity: fields.quantity,
    avgPrice: fields.avgPrice,
    manualPrice: fields.manualPrice,
    account: fields.account,
    assetClass: fields.assetClass,
    countryMix: cleanMix(source.countryMix),
    sectorMix: cleanMix(source.sectorMix),
    dividendPerShare: fields.dividendPerShare,
    memo: fields.memo,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// 국가·섹터 비율 입력 검사. rows: [{ name, percent }]
// 개별 주식(single)은 하나만 고르고 자동으로 100%가 된다. ETF는 합계가 100이 아니면 경고만 한다.
export function validateMix(rows, { label, single = false }) {
  const filled = (Array.isArray(rows) ? rows : []).filter(
    (row) => String(row?.name ?? '').trim() !== '' || String(row?.percent ?? '').trim() !== '',
  );
  if (filled.length === 0) return { error: `${label}를 골라 주세요.` };
  if (single && filled.length > 1) {
    return { error: `개별 주식은 ${label}를 하나만 골라요. 여러 개로 나누려면 종류를 ETF로 바꿔 주세요.` };
  }

  const mix = {};
  for (const row of filled) {
    const name = String(row.name ?? '').trim();
    if (!name) return { error: `${label} 이름을 골라 주세요.` };
    if (Object.hasOwn(mix, name)) return { error: `${name}이(가) 두 번 들어 있어요.` };
    const blank = row.percent == null || String(row.percent).trim() === '';
    const percent = single && blank ? 100 : parseNumberInput(row.percent);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      return { error: `${label} 비율은 0보다 크고 100 이하인 숫자로 입력해 주세요.` };
    }
    mix[name] = percent;
  }

  if (single) return { value: { [Object.keys(mix)[0]]: 100 } };
  const sum = round2(mixSum(mix));
  const warning = Math.abs(sum - 100) < 0.01 ? null : `${label} 비율 합계가 ${sum}%예요. 100%가 되도록 맞춰 주세요.`;
  return { value: mix, warning };
}

function checkTicker(ticker) {
  if (!ticker) return '티커를 입력해 주세요. (예: KRX:005930, NASDAQ:QQQ)';
  if (/^\d{6}$/.test(ticker)) return `국내 종목은 앞에 거래소를 붙여 주세요. 예: KRX:${ticker} (코스닥은 KOSDAQ:${ticker})`;
  if (ticker.length > 30 || !TICKER_PATTERN.test(ticker)) return '티커 형식이 올바르지 않아요. 예: KRX:005930, NASDAQ:QQQ';
  return null;
}

// 입력 화면·CSV에서 받은 값(문자열 포함)을 검사해서 저장할 종목을 만든다.
// input: { id?, name, ticker, type, etfSpread?, currency, quantity, avgPrice, manualPrice, account, assetClass,
//          countryRows: [{ name, percent }], sectorRows, dividendPerShare, memo }
// 돌려주는 값: { ok, value, errors: { 필드: 문구 }, warnings: { 필드: 문구 } }
export function validateHolding(input, { allowFractionalUS = false, existing = [] } = {}) {
  const errors = {};
  const warnings = {};
  const fields = {};
  const take = (key, spec) => {
    const result = coerceValue(spec, input[key]);
    if (result.ok) fields[key] = result.value;
    else errors[key] = result.error;
  };

  const name = String(input.name ?? '').trim();
  if (!name) errors.name = '종목명을 입력해 주세요.';
  else if (name.length > 60) errors.name = '60자 이하로 입력해 주세요.';

  const ticker = normalizeTicker(input.ticker);
  const tickerError = checkTicker(ticker);
  if (tickerError) errors.ticker = tickerError;

  take('type', { type: 'enum', options: HOLDING_TYPES });
  take('etfSpread', { type: 'enum', options: ETF_SPREADS, nullable: true });
  take('currency', { type: 'enum', options: CURRENCIES });
  take('account', { type: 'enum', options: ACCOUNTS });
  take('assetClass', { type: 'enum', options: ASSET_CLASSES });
  take('quantity', { type: 'number', min: 0 });
  take('avgPrice', { type: 'number', min: 0 });
  take('manualPrice', { type: 'number', nullable: true, exclusiveMin: 0 });
  take('dividendPerShare', { type: 'number', nullable: true, min: 0 });
  take('memo', { type: 'string', maxLength: 200 });

  if (fields.quantity != null && !Number.isInteger(fields.quantity)) {
    if (fields.currency !== 'USD') errors.quantity = '국내 주식 수량은 소수점 없이 입력해 주세요.';
    else if (!allowFractionalUS) errors.quantity = '소수점 수량은 설정에서 "미국 주식 소수점 매매"를 켜야 입력할 수 있어요.';
  }

  const single = fields.type === 'stock';
  for (const [key, rowsKey, label] of [['countryMix', 'countryRows', '국가'], ['sectorMix', 'sectorRows', '섹터']]) {
    const mix = validateMix(input[rowsKey], { label, single });
    if (mix.error) errors[key] = mix.error;
    else fields[key] = mix.value;
    if (mix.warning) warnings[key] = mix.warning;
  }

  const id = input.id || createId('h');
  if (!errors.ticker && fields.account) {
    const key = holdingKey({ ticker, account: fields.account });
    if (existing.some((holding) => holding.id !== id && holdingKey(holding) === key)) {
      errors.ticker = `같은 계좌(${fields.account})에 이미 있는 종목이에요. 기존 종목을 수정해 주세요.`;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, value: null, errors, warnings };
  return {
    ok: true,
    errors,
    warnings,
    value: {
      id,
      name,
      ticker,
      type: fields.type,
      etfSpread: spreadFor(fields.type, fields.etfSpread, name, ticker),
      currency: fields.currency,
      quantity: fields.quantity,
      avgPrice: fields.avgPrice,
      manualPrice: fields.manualPrice,
      account: fields.account,
      assetClass: fields.assetClass,
      countryMix: fields.countryMix,
      sectorMix: fields.sectorMix,
      dividendPerShare: fields.dividendPerShare,
      memo: fields.memo,
    },
  };
}

// 저장된 종목을 입력 화면·CSV 덮어쓰기에서 쓰는 입력값 형태로 바꾼다.
export function holdingToInput(holding) {
  const text = (value) => (value == null ? '' : String(value));
  return {
    id: holding.id,
    name: holding.name,
    ticker: holding.ticker,
    type: holding.type,
    etfSpread: holding.etfSpread ?? '',
    currency: holding.currency,
    quantity: text(holding.quantity),
    avgPrice: text(holding.avgPrice),
    manualPrice: text(holding.manualPrice),
    account: holding.account,
    assetClass: holding.assetClass,
    countryRows: mixToRows(holding.countryMix),
    sectorRows: mixToRows(holding.sectorMix),
    dividendPerShare: text(holding.dividendPerShare),
    memo: holding.memo ?? '',
  };
}
