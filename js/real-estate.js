// 부동산(집 등) 데이터 정리와 입력 검증. 시세는 직접 적고 1년에 한두 번 고친다.
//  value: 기준일(baseDate)의 시세(원)

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

export function normalizeRealEstate(raw) {
  const source = isPlainObject(raw) ? raw : {};
  return {
    id: typeof source.id === 'string' && source.id ? source.id : createId('r'),
    ...sanitizeObject(STORED_FIELDS, source),
  };
}

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
  take('value', { type: 'number', exclusiveMin: 0 }, '시세를 0보다 큰 숫자로 입력해 주세요.');
  take('baseDate', { type: 'date' }, '시세를 확인한 날을 입력해 주세요.');
  if (Object.keys(errors).length > 0) return { ok: false, value: null, errors, warnings: {} };
  return {
    ok: true,
    errors,
    warnings: {},
    value: {
      id: input.id || createId('r'),
      name,
      kind: fields.kind,
      value: fields.value,
      baseDate: fields.baseDate,
      memo: String(input.memo ?? '').trim().slice(0, 200),
      updatedAt: todayString(now),
    },
  };
}

export function realEstateToInput(item) {
  return {
    id: item.id, name: item.name, kind: item.kind, value: item.value == null ? '' : String(item.value), baseDate: item.baseDate ?? '', memo: item.memo ?? '',
  };
}

export function realEstateTotal(items) {
  return (items ?? []).reduce((sum, item) => sum + (item.value > 0 ? item.value : 0), 0);
}
