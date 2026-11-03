// 대출 데이터 정리와 입력 검증. 계산은 calc/loan.js.
//  balance: 기준일(baseDate)의 남은 대출금(원금), rate: 연 금리(%)
//  monthlyPayment: 원리금균등은 매달 갚는 금액(원금 + 이자), 원금균등은 매달 갚는 원금 (만기일시는 쓰지 않음)
//  maturity: 만기 'YYYY-MM' (원리금·원금균등은 매달 금액 대신 적어도 됨, 만기일시는 꼭 필요)
//  payDay: 매달 갚는 날(1~31, 선택)

import { LOAN_METHODS, LOAN_TYPES } from './constants.js';
import { parseMonth, todayString } from './dates.js';
import { createId } from './id.js';
import { loanSchedule, paymentMismatch } from './calc/loan.js';
import { coerceValue, isPlainObject, sanitizeObject } from './validate.js';
import { formatMoney } from './format.js';

const STORED_FIELDS = {
  name: { type: 'string', default: '' },
  type: { type: 'enum', options: LOAN_TYPES, default: '기타' },
  method: { type: 'enum', options: LOAN_METHODS, default: 'equalPayment' },
  balance: { type: 'number', min: 0, default: 0 },
  rate: { type: 'number', min: 0, max: 30, default: 0 },
  baseDate: { type: 'date', nullable: true, default: null },
  monthlyPayment: { type: 'number', nullable: true, min: 0, default: null },
  maturity: { type: 'yearMonth', nullable: true, default: null },
  payDay: { type: 'integer', nullable: true, min: 1, max: 31, default: null },
  memo: { type: 'string', default: '' },
  updatedAt: { type: 'date', nullable: true, default: null },
};

export function normalizeLoan(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const fields = sanitizeObject(STORED_FIELDS, source);
  return {
    id: typeof source.id === 'string' && source.id ? source.id : createId('l'),
    ...fields,
    monthlyPayment: fields.method === 'bullet' ? null : fields.monthlyPayment,
  };
}

const won = (value) => formatMoney(value, { unit: 'won' });

// 입력 화면의 값(문자열 포함)을 검사해서 저장할 항목을 만든다. 저장하면 갱신일이 오늘이 된다.
export function validateLoan(input, { now = new Date() } = {}) {
  const errors = {};
  const warnings = {};
  const fields = {};
  const take = (key, spec, message) => {
    const result = coerceValue(spec, input[key]);
    if (result.ok) fields[key] = result.value;
    else errors[key] = message ?? result.error;
  };

  const name = String(input.name ?? '').trim();
  if (!name) errors.name = '이름을 입력해 주세요. (예: 집 주택담보대출)';
  else if (name.length > 40) errors.name = '40자 이하로 입력해 주세요.';

  take('type', { type: 'enum', options: LOAN_TYPES });
  take('method', { type: 'enum', options: LOAN_METHODS });
  take('balance', { type: 'number', exclusiveMin: 0 }, '지금 남은 대출금을 0보다 큰 숫자로 입력해 주세요.');
  take('rate', { type: 'number', min: 0, max: 30 }, '금리를 0~30% 사이 숫자로 입력해 주세요. (예: 4.2)');
  take('baseDate', { type: 'date' }, '남은 대출금을 확인한 날을 입력해 주세요.');
  take('monthlyPayment', { type: 'number', nullable: true, exclusiveMin: 0 }, '0보다 큰 숫자로 입력해 주세요.');
  take('maturity', { type: 'yearMonth', nullable: true });
  take('payDay', { type: 'integer', nullable: true, min: 1, max: 31 }, '1~31 사이 날짜로 입력해 주세요.');
  const memo = String(input.memo ?? '').trim().slice(0, 200);

  const method = fields.method;
  if (method === 'bullet' && !errors.maturity && !fields.maturity) errors.maturity = '만기일시는 만기가 있어야 계산할 수 있어요.';
  if (method !== 'bullet' && !errors.monthlyPayment && !errors.maturity && !fields.monthlyPayment && !fields.maturity) {
    errors.monthlyPayment = method === 'equalPayment'
      ? '매월 상환액이나 만기 중 하나는 적어 주세요.'
      : '매달 갚는 원금이나 만기 중 하나는 적어 주세요.';
  }
  const base = parseMonth(fields.baseDate);
  const maturity = parseMonth(fields.maturity);
  if (base != null && maturity != null && maturity < base) errors.maturity = '만기가 기준일보다 앞이에요.';

  if (Object.keys(errors).length === 0) {
    const value = { ...fields, monthlyPayment: method === 'bullet' ? null : fields.monthlyPayment };
    const schedule = loanSchedule(value);
    if (schedule.error === 'too-small') {
      const interest = fields.balance * (fields.rate / 100 / 12);
      errors.monthlyPayment = `매월 상환액이 한 달 이자(약 ${won(interest)})보다 적거나 같아서 원금이 줄지 않아요. 금액을 확인해 주세요.`;
    }
    const mismatch = paymentMismatch(value);
    if (mismatch) warnings.monthlyPayment = `만기에 맞추려면 매월 약 ${won(mismatch.expected)}이에요. 은행 앱의 금액과 맞는지 확인해 주세요.`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, value: null, errors, warnings };
  return {
    ok: true,
    errors,
    warnings,
    value: {
      id: input.id || createId('l'),
      name,
      type: fields.type,
      method,
      balance: fields.balance,
      rate: fields.rate,
      baseDate: fields.baseDate,
      monthlyPayment: method === 'bullet' ? null : fields.monthlyPayment,
      maturity: fields.maturity,
      payDay: fields.payDay,
      memo,
      updatedAt: todayString(now),
    },
  };
}

// 저장된 항목 → 입력 화면 값
export function loanToInput(loan) {
  const text = (value) => (value == null ? '' : String(value));
  return {
    id: loan.id,
    name: loan.name,
    type: loan.type,
    method: loan.method,
    balance: text(loan.balance),
    rate: text(loan.rate),
    baseDate: loan.baseDate ?? '',
    monthlyPayment: text(loan.monthlyPayment),
    maturity: loan.maturity ?? '',
    payDay: text(loan.payDay),
    memo: loan.memo ?? '',
  };
}
