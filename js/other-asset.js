// 공제회·예적금 데이터 정리와 입력 검증 (요청서 3-2)

import { COMPOUNDING_TYPES, INTEREST_TAX_RATES, OTHER_ASSET_TYPES } from './constants.js';
import { parseMonth, todayString } from './dates.js';
import { createId } from './id.js';
import { coerceValue, isPlainObject, normalizeScenarioRates, sanitizeObject, validateScenarioRates } from './validate.js';

const TAX_RATE_SPEC = { type: 'number', min: 0, max: 50 };

const STORED_FIELDS = {
  name: { type: 'string', default: '' },
  type: { type: 'enum', options: OTHER_ASSET_TYPES, default: '기타' },
  balance: { type: 'number', min: 0, default: 0 },
  baseDate: { type: 'date', nullable: true, default: null },
  monthlyContribution: { type: 'number', min: 0, default: 0 },
  contributionGrowthRate: { type: 'number', min: 0, max: 100, default: 0 },
  compounding: { type: 'enum', options: COMPOUNDING_TYPES, default: '월복리' },
  contributionEndDate: { type: 'yearMonth', nullable: true, default: null },
  payoutDate: { type: 'yearMonth', nullable: true, default: null },
  applyTax: { type: 'boolean', default: true },
  updatedAt: { type: 'date', nullable: true, default: null },
};

// 종류별 이자 세율 기본값(%)
export function defaultTaxRate(type) {
  return INTEREST_TAX_RATES[type] ?? INTEREST_TAX_RATES.기타;
}

export function normalizeOtherAsset(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const fields = sanitizeObject(STORED_FIELDS, source);
  const taxRate = coerceValue(TAX_RATE_SPEC, source.taxRate);
  return {
    id: typeof source.id === 'string' && source.id ? source.id : createId('o'),
    name: fields.name,
    type: fields.type,
    balance: fields.balance,
    baseDate: fields.baseDate,
    monthlyContribution: fields.monthlyContribution,
    contributionGrowthRate: fields.contributionGrowthRate,
    interestRates: normalizeScenarioRates(source.interestRates),
    compounding: fields.compounding,
    contributionEndDate: fields.contributionEndDate,
    payoutDate: fields.payoutDate,
    applyTax: fields.applyTax,
    taxRate: taxRate.ok ? taxRate.value : defaultTaxRate(fields.type),
    updatedAt: fields.updatedAt,
  };
}

// 입력 화면의 값(문자열 포함)을 검사해서 저장할 항목을 만든다. 저장하면 갱신일이 오늘이 된다.
export function validateOtherAsset(input, { now = new Date() } = {}) {
  const errors = {};
  const warnings = {};
  const fields = {};
  const take = (key, spec, message) => {
    const result = coerceValue(spec, input[key]);
    if (result.ok) fields[key] = result.value;
    else errors[key] = message ?? result.error;
  };

  const name = String(input.name ?? '').trim();
  if (!name) errors.name = '이름을 입력해 주세요. (예: 행정공제회)';
  else if (name.length > 40) errors.name = '40자 이하로 입력해 주세요.';

  take('type', { type: 'enum', options: OTHER_ASSET_TYPES });
  take('balance', { type: 'number', min: 0 });
  take('baseDate', { type: 'date' }, '적립금 기준일을 입력해 주세요.');
  take('monthlyContribution', { type: 'number', min: 0, nullable: true });
  take('contributionGrowthRate', { type: 'number', min: 0, max: 30, nullable: true });
  take('compounding', { type: 'enum', options: COMPOUNDING_TYPES });
  take('contributionEndDate', { type: 'yearMonth', nullable: true });
  take('payoutDate', { type: 'yearMonth' }, '수령(해지) 예정 시점을 입력해 주세요.');

  const rates = validateScenarioRates(input.interestRates, { min: -5, max: 30 });
  if (rates.error) errors.interestRates = rates.error;
  if (rates.warning) warnings.interestRates = rates.warning;

  // 세금을 빼지 않을 때는 세율 칸이 숨겨지므로, 비어 있거나 틀려도 기본값으로 둔다
  const applyTax = input.applyTax ?? true;
  const taxRate = coerceValue(TAX_RATE_SPEC, input.taxRate);
  if (applyTax && !taxRate.ok) errors.taxRate = '세율을 0~50% 사이 숫자로 입력해 주세요. 세금이 없으면 스위치를 끄세요.';

  const monthly = fields.monthlyContribution ?? 0;
  if (!errors.contributionEndDate && monthly > 0 && !fields.contributionEndDate) {
    errors.contributionEndDate = '매달 넣는 돈이 있으면 납입 종료 시점을 입력해 주세요.';
  }

  const base = parseMonth(fields.baseDate);
  const end = parseMonth(fields.contributionEndDate);
  const payout = parseMonth(fields.payoutDate);
  if (base != null && end != null && monthly > 0 && end <= base) {
    warnings.contributionEndDate = '납입 종료 시점이 기준일보다 앞이에요. 앞으로 넣을 돈은 없다고 계산해요.';
  }
  if (base != null && payout != null && payout < base) {
    warnings.payoutDate = '수령 시점이 기준일보다 앞이에요. 이미 받은 돈이라면 지워 주세요.';
  } else if (end != null && payout != null && monthly > 0 && payout < end) {
    warnings.payoutDate = '수령 시점이 납입 종료보다 빨라요. 수령 시점까지만 넣는다고 계산해요.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, value: null, errors, warnings };
  return {
    ok: true,
    errors,
    warnings,
    value: {
      id: input.id || createId('o'),
      name,
      type: fields.type,
      balance: fields.balance,
      baseDate: fields.baseDate,
      monthlyContribution: monthly,
      contributionGrowthRate: fields.contributionGrowthRate ?? 0,
      interestRates: rates.value,
      compounding: fields.compounding,
      contributionEndDate: fields.contributionEndDate,
      payoutDate: fields.payoutDate,
      applyTax: Boolean(applyTax),
      taxRate: taxRate.ok ? taxRate.value : defaultTaxRate(fields.type),
      updatedAt: todayString(now),
    },
  };
}

// 저장된 항목 → 입력 화면 값
export function otherAssetToInput(asset) {
  const text = (value) => (value == null ? '' : String(value));
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    balance: text(asset.balance),
    baseDate: asset.baseDate ?? '',
    monthlyContribution: asset.monthlyContribution ? text(asset.monthlyContribution) : '',
    contributionGrowthRate: asset.contributionGrowthRate ? text(asset.contributionGrowthRate) : '',
    interestRates: {
      low: text(asset.interestRates.low),
      base: text(asset.interestRates.base),
      high: text(asset.interestRates.high),
    },
    compounding: asset.compounding,
    contributionEndDate: asset.contributionEndDate ?? '',
    payoutDate: asset.payoutDate ?? '',
    applyTax: asset.applyTax,
    taxRate: text(asset.taxRate),
  };
}
