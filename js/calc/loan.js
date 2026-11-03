// 대출 계산: 기준일의 남은 원금·금리·갚는 방식으로 매달 갚는 돈(원금 몫 + 이자 몫), 오늘 남은 원금, 다 갚는 날.
//  원리금균등: 매달 같은 금액. 이자 = 남은 원금 × 월 이율, 원금 몫 = 매달 금액 − 이자
//  원금균등: 매달 같은 원금. 내는 돈 = 원금 몫 + 이자 (점점 줄어듦)
//  만기일시: 매달 이자만, 만기 달에 원금을 한꺼번에
// 갚는 날은 매달 payDay일 (없으면 기준일과 같은 날, 그 달에 없는 날이면 그 달 마지막 날).
// 기준일에 적은 금액은 그날 갚은 뒤의 남은 원금으로 보고, 기준일 다음 갚는 날부터 줄어든다.
// 날짜는 모두 'YYYY-MM-DD' 문자열 (같은 길이라 글자 순서로 비교할 수 있다).

import { LOAN_METHODS } from '../constants.js';
import { monthIndexOf, monthOf, parseMonth, todayString, yearOf } from '../dates.js';

// 50년이 지나도 다 못 갚으면 계산을 멈춘다
const MAX_PAYMENTS = 600;

const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const pad = (value) => String(value).padStart(2, '0');

function parseDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text ?? ''));
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
}

// 달 번호의 갚는 날 'YYYY-MM-DD'
function payDateOf(monthIndex, payDay) {
  const year = yearOf(monthIndex);
  const month = monthOf(monthIndex);
  return `${year}-${pad(month)}-${pad(Math.min(payDay, daysInMonth(year, month)))}`;
}

// 기준일 다음 첫 갚는 날의 달 번호
function firstPayMonth(base, payDay) {
  const baseMonth = monthIndexOf(base.year, base.month);
  const thisMonthDate = payDateOf(baseMonth, payDay);
  const baseDate = `${base.year}-${pad(base.month)}-${pad(base.day)}`;
  return thisMonthDate > baseDate ? baseMonth : baseMonth + 1;
}

// 원리금균등 매달 금액 (남은 원금을 n번에 나눠 갚을 때)
export function equalPaymentAmount(balance, annualRate, count) {
  if (!(balance > 0) || !(count > 0)) return 0;
  const rate = annualRate / 100 / 12;
  if (rate === 0) return balance / count;
  return (balance * rate) / (1 - (1 + rate) ** -count);
}

// 대출 하나의 갚는 일정 (기준일 다음 갚는 날부터 다 갚을 때까지, 최대 50년)
//  돌려주는 값: { payments: [{ date, payment, principal, interest, balance }], perMonth, paysOff, error }
//   perMonth: 원리금균등은 매달 금액, 원금균등은 매달 원금 (적은 값, 없으면 만기로 계산한 값)
//   paysOff: 다 갚는지 (매달 금액이 이자보다 적으면 영영 못 갚음)
//   error: 'no-plan'(매달 금액도 만기도 없음) | 'too-small'(매달 금액이 이자보다 적거나 같음) | null
export function loanSchedule(loan) {
  const base = parseDate(loan.baseDate);
  const balance0 = loan.balance > 0 ? loan.balance : 0;
  const method = LOAN_METHODS.includes(loan.method) ? loan.method : 'equalPayment';
  const rate = (loan.rate > 0 ? loan.rate : 0) / 100 / 12;
  const result = { payments: [], perMonth: null, paysOff: true, error: null, method };
  if (!base || balance0 <= 0) return result;
  const payDay = Number.isInteger(loan.payDay) && loan.payDay >= 1 && loan.payDay <= 31 ? loan.payDay : base.day;
  const start = firstPayMonth(base, payDay);
  const maturityMonth = parseMonth(loan.maturity);
  const countToMaturity = maturityMonth != null ? Math.max(1, maturityMonth - start + 1) : null;

  let perMonth = loan.monthlyPayment > 0 ? loan.monthlyPayment : null;
  if (method === 'equalPayment' && perMonth == null && countToMaturity) perMonth = equalPaymentAmount(balance0, loan.rate ?? 0, countToMaturity);
  if (method === 'equalPrincipal' && perMonth == null && countToMaturity) perMonth = balance0 / countToMaturity;
  result.perMonth = method === 'bullet' ? null : perMonth;
  if (method !== 'bullet' && perMonth == null) {
    result.error = 'no-plan';
    return result;
  }
  if (method === 'bullet' && maturityMonth == null) result.paysOff = false; // 만기가 없으면 이자만 계속

  let balance = balance0;
  for (let i = 0; i < MAX_PAYMENTS && balance > 0.005; i += 1) {
    const month = start + i;
    const interest = balance * rate;
    let principal;
    if (method === 'equalPayment') {
      if (i === 0 && perMonth <= interest) {
        result.error = 'too-small';
        result.paysOff = false;
      }
      principal = Math.min(balance, Math.max(0, perMonth - interest));
    } else if (method === 'equalPrincipal') {
      principal = Math.min(balance, perMonth);
    } else {
      principal = maturityMonth != null && month >= maturityMonth ? balance : 0;
    }
    balance -= principal;
    if (balance < 0.005) balance = 0;
    result.payments.push({ date: payDateOf(month, payDay), payment: principal + interest, principal, interest, balance });
    if (result.error === 'too-small' || (method === 'bullet' && !result.paysOff && i >= 11)) break; // 끝없이 이자만: 1년치만
  }
  if (balance > 0) result.paysOff = false;
  return result;
}

// 오늘 기준 대출 상태
//  { balance: 오늘 남은 원금, next: 다음에 갚을 { date, payment, principal, interest } | null,
//    payoffDate: 다 갚는 날 | null, remainingCount: 남은 횟수, interestLeft: 앞으로 낼 이자 합계(다 갚을 때까지, 못 갚으면 null),
//    perMonth, paysOff, error, estimated: 기준일 뒤에 갚은 회차가 있어 오늘 금액을 계산했는지 }
export function loanStatus(loan, { today = todayString() } = {}) {
  const schedule = loanSchedule(loan);
  const done = schedule.payments.filter((payment) => payment.date <= today);
  const left = schedule.payments.filter((payment) => payment.date > today);
  const balance = done.length > 0 ? done[done.length - 1].balance : (loan.balance > 0 ? loan.balance : 0);
  const finished = schedule.paysOff && left.length === 0 && schedule.payments.length > 0;
  return {
    balance: finished ? 0 : balance,
    next: left[0] ?? null,
    payoffDate: schedule.paysOff && schedule.payments.length > 0 ? schedule.payments[schedule.payments.length - 1].date : null,
    remainingCount: left.length,
    interestLeft: schedule.paysOff ? left.reduce((sum, payment) => sum + payment.interest, 0) : null,
    perMonth: schedule.perMonth,
    paysOff: schedule.paysOff,
    error: schedule.error,
    estimated: done.length > 0,
    finished,
  };
}

// 원리금균등에서 매달 금액과 만기를 둘 다 적었을 때, 만기에 맞는 매달 금액과 얼마나 다른지 (5% 넘게 다르면 알림)
export function paymentMismatch(loan) {
  if (loan.method !== 'equalPayment' || !(loan.monthlyPayment > 0) || !loan.maturity) return null;
  const expected = loanSchedule({ ...loan, monthlyPayment: null }).perMonth;
  if (!(expected > 0)) return null;
  const gap = Math.abs(loan.monthlyPayment - expected) / expected;
  return gap > 0.05 ? { expected, gap } : null;
}

// 여러 대출 합계: 오늘 남은 원금, 이번 달(다음 회차) 갚는 돈과 원금·이자 몫, 가장 늦게 다 갚는 날
export function loansSummary(loans, { today = todayString() } = {}) {
  const items = (loans ?? []).map((loan) => ({ loan, status: loanStatus(loan, { today }) }));
  const sum = (pick) => items.reduce((total, item) => total + (pick(item) ?? 0), 0);
  const payoffDates = items.map((item) => item.status.payoffDate).filter(Boolean).sort();
  return {
    items,
    balance: sum((item) => item.status.balance),
    monthlyPayment: sum((item) => item.status.next?.payment),
    monthlyPrincipal: sum((item) => item.status.next?.principal),
    monthlyInterest: sum((item) => item.status.next?.interest),
    lastPayoffDate: payoffDates[payoffDates.length - 1] ?? null,
    neverPaysOff: items.filter((item) => !item.status.paysOff && !item.status.finished),
  };
}
