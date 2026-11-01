// 연금 데이터 정리와 입력 검증 (요청서 3-3)
//  확정 수령형(fixed): 기관에서 조회한 예상 월 수령액을 그대로 쓴다.
//  적립형(accumulating): 적립금을 굴려 수령 개시 때 월 수령액을 계산한다. 보유 종목 계좌와 연결할 수 있다.

import {
  AMOUNT_BASES, DEFAULT_SETTINGS, LINKABLE_ACCOUNTS, PAYOUT_TYPES, PENSION_CATEGORIES, PENSION_KINDS,
} from './constants.js';
import { currentMonthIndex, monthIndexAtAge, parseMonth, todayString } from './dates.js';
import { createId } from './id.js';
import { coerceValue, isPlainObject, normalizeScenarioRates, sanitizeObject, validateScenarioRates } from './validate.js';

// 공무원연금·국민연금은 물가에 맞춰 오르는 게 보통이라 기본값을 켠다.
export const INFLATION_INDEXED_CATEGORIES = Object.freeze(['공무원연금', '국민연금']);

// 연금마다 정하는 세율(%). 처음 값(기본값)은 설정의 '연금 세율 기본값'
const TAX_RATE_SPEC = { type: 'number', min: 0, max: 50 };

// 이보다 작은 월 수령액·적립금은 만원 단위로 잘못 적은 것으로 본다 (금액 칸은 원 단위)
export const TOO_SMALL_MONTHLY = 10_000;
const TOO_SMALL_BALANCE = 10_000;

const COMMON_FIELDS = {
  name: { type: 'string', default: '' },
  category: { type: 'enum', options: PENSION_CATEGORIES, default: '기타' },
  kind: { type: 'enum', options: PENSION_KINDS, default: 'fixed' },
  startAge: { type: 'integer', nullable: true, min: 40, max: 100, default: null },
  payoutType: { type: 'enum', options: PAYOUT_TYPES, default: '종신' },
  payoutYears: { type: 'integer', nullable: true, min: 1, max: 60, default: null },
  applyTax: { type: 'boolean', default: true },
  updatedAt: { type: 'date', nullable: true, default: null },
  memo: { type: 'string', default: '' },
};

const FIXED_FIELDS = {
  expectedMonthlyAmount: { type: 'number', min: 0, default: 0 },
  amountBasis: { type: 'enum', options: AMOUNT_BASES, default: 'present' },
  inflationIndexed: { type: 'boolean', default: false },
  inquiryDate: { type: 'date', nullable: true, default: null },
};

const ACCUMULATING_FIELDS = {
  linkedAccount: { type: 'enum', options: LINKABLE_ACCOUNTS, nullable: true, default: null },
  balance: { type: 'number', min: 0, default: 0 },
  baseDate: { type: 'date', nullable: true, default: null },
  monthlyContribution: { type: 'number', min: 0, default: 0 },
  contributionEndDate: { type: 'yearMonth', nullable: true, default: null },
};

// defaultTaxRate: 세율이 없던 예전 데이터에 넣을 값 (설정의 연금 세율 기본값)
export function normalizePension(raw, { defaultTaxRate = DEFAULT_SETTINGS.pensionTaxRate } = {}) {
  const source = isPlainObject(raw) ? raw : {};
  const common = sanitizeObject(COMMON_FIELDS, source);
  const taxRate = coerceValue(TAX_RATE_SPEC, source.taxRate);
  const base = {
    id: typeof source.id === 'string' && source.id ? source.id : createId('p'),
    ...common,
    taxRate: taxRate.ok ? taxRate.value : defaultTaxRate,
  };
  if (common.kind === 'fixed') return { ...base, ...sanitizeObject(FIXED_FIELDS, source) };
  return { ...base, ...sanitizeObject(ACCUMULATING_FIELDS, source), expectedReturns: normalizeScenarioRates(source.expectedReturns) };
}

// 입력 화면의 값을 검사해서 저장할 연금을 만든다.
// options.existing: 다른 연금들 (같은 계좌에 두 연금을 연결하지 않게), birthYear/birthMonth: 이미 받는 나이인지 안내
// options.defaultTaxRate: 세금을 빼지 않아 세율 칸이 비어 있을 때 넣어 둘 값
export function validatePension(input, {
  existing = [], birthYear = null, birthMonth = 1, now = new Date(), defaultTaxRate = DEFAULT_SETTINGS.pensionTaxRate,
} = {}) {
  const errors = {};
  const warnings = {};
  const fields = {};
  const take = (key, spec, message) => {
    const result = coerceValue(spec, input[key]);
    if (result.ok) fields[key] = result.value;
    else errors[key] = message ?? result.error;
  };

  const name = String(input.name ?? '').trim();
  if (!name) errors.name = '이름을 입력해 주세요. (예: 공무원연금, 연금저축-A증권)';
  else if (name.length > 40) errors.name = '40자 이하로 입력해 주세요.';

  take('category', { type: 'enum', options: PENSION_CATEGORIES });
  take('kind', { type: 'enum', options: PENSION_KINDS });
  take('startAge', { type: 'integer', min: 40, max: 100 });
  take('payoutType', { type: 'enum', options: PAYOUT_TYPES });
  take('applyTax', { type: 'boolean' });
  take('memo', { type: 'string', maxLength: 200 });
  if (fields.payoutType === '기간 지정') take('payoutYears', { type: 'integer', min: 1, max: 60 }, '받는 기간을 1 ~ 60년 사이로 입력해 주세요.');
  // 세금을 빼지 않을 때는 세율 칸이 숨겨지므로, 비어 있거나 틀려도 기본값으로 둔다
  const taxRate = coerceValue(TAX_RATE_SPEC, input.taxRate);
  if (fields.applyTax && !taxRate.ok) errors.taxRate = '세율을 0~50% 사이 숫자로 입력해 주세요. 세금을 빼지 않으려면 스위치를 끄세요.';

  if (fields.startAge != null && birthYear) {
    if (monthIndexAtAge(fields.startAge, birthYear, birthMonth) < currentMonthIndex(now)) {
      warnings.startAge = '이미 받기 시작한 나이예요. 지금부터 받는다고 계산해요.';
    }
  }

  const value = {
    id: input.id || createId('p'),
    name,
    category: fields.category,
    kind: fields.kind,
    startAge: fields.startAge,
    payoutType: fields.payoutType,
    payoutYears: fields.payoutType === '기간 지정' ? fields.payoutYears : null,
    applyTax: fields.applyTax,
    taxRate: taxRate.ok ? taxRate.value : defaultTaxRate,
    updatedAt: todayString(now),
    memo: fields.memo ?? '',
  };

  if (fields.kind === 'fixed') {
    take('expectedMonthlyAmount', { type: 'number', min: 0 });
    // 만원 단위로 적는 실수(150만원 → 150) 막기: 월 1만원도 안 되는 연금은 없다고 보고 저장하지 않는다
    if (fields.expectedMonthlyAmount > 0 && fields.expectedMonthlyAmount < TOO_SMALL_MONTHLY) {
      errors.expectedMonthlyAmount = `월 ${fields.expectedMonthlyAmount}원으로 적혀 있어요. 원 단위로 적어 주세요. 예: 150만원 → 1500000`;
    }
    take('amountBasis', { type: 'enum', options: AMOUNT_BASES }, '조회한 금액이 현재가치인지 미래 금액인지 골라 주세요.');
    take('inflationIndexed', { type: 'boolean' });
    take('inquiryDate', { type: 'date', nullable: true });
    Object.assign(value, {
      expectedMonthlyAmount: fields.expectedMonthlyAmount,
      amountBasis: fields.amountBasis,
      inflationIndexed: fields.inflationIndexed,
      inquiryDate: fields.inquiryDate,
    });
  } else if (fields.kind === 'accumulating') {
    take('linkedAccount', { type: 'enum', options: LINKABLE_ACCOUNTS, nullable: true });
    const linked = fields.linkedAccount ?? null;
    if (linked) {
      fields.balance = 0;
      fields.baseDate = null;
      const other = existing.find((pension) => pension.id !== value.id && pension.kind === 'accumulating' && pension.linkedAccount === linked);
      if (other) errors.linkedAccount = `'${other.name}'이(가) 이미 ${linked} 계좌와 연결돼 있어요. 한 계좌에는 연금 하나만 연결할 수 있어요.`;
    } else {
      take('balance', { type: 'number', min: 0 });
      take('baseDate', { type: 'date' }, '적립금 기준일을 입력해 주세요.');
      // 새로 만든 계좌면 적을 수 있는 금액이라 막지는 않고 알려만 준다
      if (fields.balance > 0 && fields.balance < TOO_SMALL_BALANCE) {
        warnings.balance = `적립금이 ${fields.balance}원으로 적혀 있어요. 금액은 원 단위예요 (3,000만원 → 30000000).`;
      }
    }
    take('monthlyContribution', { type: 'number', min: 0, nullable: true });
    take('contributionEndDate', { type: 'yearMonth', nullable: true });
    const monthly = fields.monthlyContribution ?? 0;
    if (!errors.contributionEndDate && monthly > 0 && !fields.contributionEndDate) {
      errors.contributionEndDate = '매달 넣는 돈이 있으면 납입 종료 시점을 입력해 주세요.';
    }
    const returns = validateScenarioRates(input.expectedReturns, { min: -10, max: 30 });
    if (returns.error) errors.expectedReturns = returns.error;
    if (returns.warning) warnings.expectedReturns = returns.warning;

    const end = parseMonth(fields.contributionEndDate);
    if (end != null && fields.startAge != null && birthYear && monthly > 0 && end > monthIndexAtAge(fields.startAge, birthYear, birthMonth)) {
      warnings.contributionEndDate = '납입 종료가 수령 시작보다 늦어요. 수령 시작 전까지만 넣는다고 계산해요.';
    }
    Object.assign(value, {
      linkedAccount: linked,
      balance: fields.balance,
      baseDate: fields.baseDate,
      monthlyContribution: monthly,
      contributionEndDate: fields.contributionEndDate,
      expectedReturns: returns.value,
    });
  }

  if (Object.keys(errors).length > 0) return { ok: false, value: null, errors, warnings };
  return { ok: true, value, errors, warnings };
}

// 저장된 연금 → 입력 화면 값
export function pensionToInput(pension) {
  const text = (value) => (value == null ? '' : String(value));
  const input = {
    id: pension.id,
    name: pension.name,
    category: pension.category,
    kind: pension.kind,
    startAge: text(pension.startAge),
    payoutType: pension.payoutType,
    payoutYears: text(pension.payoutYears),
    applyTax: pension.applyTax,
    taxRate: text(pension.taxRate),
    memo: pension.memo ?? '',
  };
  if (pension.kind === 'fixed') {
    return {
      ...input,
      expectedMonthlyAmount: text(pension.expectedMonthlyAmount),
      amountBasis: pension.amountBasis ?? '',
      inflationIndexed: pension.inflationIndexed,
      inquiryDate: pension.inquiryDate ?? '',
    };
  }
  return {
    ...input,
    linkedAccount: pension.linkedAccount ?? '',
    balance: pension.linkedAccount ? '' : text(pension.balance),
    baseDate: pension.baseDate ?? '',
    monthlyContribution: pension.monthlyContribution ? text(pension.monthlyContribution) : '',
    contributionEndDate: pension.contributionEndDate ?? '',
    expectedReturns: {
      low: text(pension.expectedReturns.low),
      base: text(pension.expectedReturns.base),
      high: text(pension.expectedReturns.high),
    },
  };
}
