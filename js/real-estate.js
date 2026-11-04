// 부동산(집 등) 데이터 정리와 입력 검증.
//  value: 직접 적은 시세(원, 기준일 baseDate). 1년에 한두 번 고친다.
//  auto: 아파트 실거래가로 자동 계산할 단지 { lawd(시·군·구 코드), district(이름), apt(단지 일련번호), name, dong, area(전용면적 ㎡),
//        areas(선택: 'OO평형 전체'로 합쳐 볼 전용면적들) }
//  market: 마지막으로 받은 실거래가 평균 { average, months, count, min, max, from, to, trades, fetchedAt }
//          평균이 있으면 그 값을, 없으면(1년 동안 거래 없음) 직접 적은 값을 쓴다.

import { REAL_ESTATE_KINDS } from './constants.js';
import { todayString } from './dates.js';
import { createId } from './id.js';
import { coerceValue, isPlainObject, sanitizeObject } from './validate.js';

const STORED_FIELDS = {
  name: { type: 'string', default: '' },
  kind: { type: 'enum', options: REAL_ESTATE_KINDS, default: '아파트' },
  value: { type: 'number', min: 0, default: 0 },
  baseDate: { type: 'date', nullable: true, default: null },
  memo: { type: 'string', default: '' },
  updatedAt: { type: 'date', nullable: true, default: null },
};

const text = (value, max = 80) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const positiveOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);

function normalizeAuto(raw) {
  if (!isPlainObject(raw) || !/^\d{5}$/.test(String(raw.lawd ?? '')) || !(raw.area > 0) || (!raw.apt && !raw.name)) return null;
  const auto = { lawd: String(raw.lawd), district: text(raw.district), apt: text(raw.apt, 40), name: text(raw.name), dong: text(raw.dong, 40), area: Number(raw.area) };
  const areas = Array.isArray(raw.areas) ? [...new Set(raw.areas.map(Number).filter((value) => Number.isFinite(value) && value > 0))].sort((a, b) => a - b).slice(0, 10) : [];
  if (areas.length > 1) auto.areas = areas;
  return auto;
}

function normalizeMarket(raw) {
  if (!isPlainObject(raw) || typeof raw.fetchedAt !== 'string') return null;
  return {
    average: positiveOrNull(raw.average),
    months: Number.isInteger(raw.months) ? raw.months : null,
    count: Number.isInteger(raw.count) && raw.count > 0 ? raw.count : 0,
    min: positiveOrNull(raw.min),
    max: positiveOrNull(raw.max),
    from: text(raw.from, 6),
    to: text(raw.to, 6),
    trades: Array.isArray(raw.trades) ? raw.trades.filter(isPlainObject).slice(0, 10).map((trade) => ({
      date: text(trade.date, 10), amount: positiveOrNull(trade.amount) ?? 0, floor: Number(trade.floor) || 0, area: Number(trade.area) || 0,
    })) : [],
    fetchedAt: raw.fetchedAt,
  };
}

export function normalizeRealEstate(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const auto = normalizeAuto(source.auto);
  return {
    id: typeof source.id === 'string' && source.id ? source.id : createId('r'),
    ...sanitizeObject(STORED_FIELDS, source),
    auto,
    market: auto ? normalizeMarket(source.market) : null,
  };
}

// 순자산에 쓰는 값: 실거래가 평균이 있으면 그 값, 없으면 직접 적은 시세
export function realEstateValue(item) {
  if (item?.auto && item.market?.average > 0) return item.market.average;
  return item?.value > 0 ? item.value : 0;
}

// input.auto·input.market: 실거래가로 자동 계산할 때 (그때는 직접 적는 시세가 없어도 되지만, 거래가 없으면 시세가 필요)
export function validateRealEstate(input, { now = new Date() } = {}) {
  const errors = {};
  const fields = {};
  const take = (key, spec, message) => {
    const result = coerceValue(spec, input[key]);
    if (result.ok) fields[key] = result.value;
    else errors[key] = message ?? result.error;
  };
  const name = String(input.name ?? '').trim();
  if (!name) errors.name = '이름을 입력해 주세요. (예: 우리 집)';
  else if (name.length > 40) errors.name = '40자 이하로 입력해 주세요.';
  take('kind', { type: 'enum', options: REAL_ESTATE_KINDS });
  const auto = normalizeAuto(input.auto);
  const market = auto ? normalizeMarket(input.market) : null;
  const hasAverage = Boolean(market?.average);
  take('value', { type: 'number', exclusiveMin: 0, nullable: hasAverage }, hasAverage ? '0보다 큰 숫자로 입력해 주세요.' : '시세를 0보다 큰 숫자로 입력해 주세요.');
  take('baseDate', { type: 'date', nullable: hasAverage }, '시세를 확인한 날을 입력해 주세요.');
  if (auto && !market) errors.auto = '"실거래가 받아오기"를 눌러 평균을 받아 주세요. (자동 계산을 끄면 직접 적은 시세를 써요)';
  if (Object.keys(errors).length > 0) return { ok: false, value: null, errors, warnings: {} };
  return {
    ok: true,
    errors,
    warnings: {},
    value: {
      id: input.id || createId('r'),
      name,
      kind: fields.kind,
      value: fields.value ?? 0,
      baseDate: fields.baseDate,
      memo: String(input.memo ?? '').trim().slice(0, 200),
      updatedAt: todayString(now),
      auto,
      market,
    },
  };
}

export function realEstateToInput(item) {
  return {
    id: item.id, name: item.name, kind: item.kind, value: item.value > 0 ? String(item.value) : '', baseDate: item.baseDate ?? '', memo: item.memo ?? '',
    auto: item.auto ?? null, market: item.market ?? null,
  };
}

export function realEstateTotal(items) {
  return (items ?? []).reduce((sum, item) => sum + realEstateValue(item), 0);
}
