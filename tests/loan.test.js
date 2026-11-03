import { test } from 'node:test';
import assert from 'node:assert/strict';
import { equalPaymentAmount, loanSchedule, loanStatus, loansSummary, paymentMismatch } from '../js/calc/loan.js';
import { loanToInput, normalizeLoan, validateLoan } from '../js/loan.js';
import { normalizeRealEstate, realEstateTotal, validateRealEstate } from '../js/real-estate.js';
import { normalizeData } from '../js/storage.js';

const near = (actual, expected, tolerance = 1, message = '') => assert.ok(Math.abs(actual - expected) <= tolerance, `${message} ${actual} ≠ ${expected}`);

// 원리금균등: 2억 3천만원, 연 4.2%, 매월 125만원, 매달 25일
const mortgage = { balance: 230_000_000, rate: 4.2, method: 'equalPayment', baseDate: '2026-11-03', monthlyPayment: 1_250_000, payDay: 25 };

test('원리금균등: 매달 같은 금액, 이자 = 남은 원금 × 월 이율, 원금 몫 = 나머지', () => {
  const status = loanStatus(mortgage, { today: '2026-11-03' });
  assert.equal(status.next.date, '2026-11-25');
  near(status.next.interest, 805_000, 0.01, '230,000,000 × 4.2% / 12');
  near(status.next.principal, 445_000, 0.01);
  near(status.next.payment, 1_250_000, 0.01);
  assert.equal(status.balance, 230_000_000, '기준일 금액 그대로 (아직 갚는 날이 안 옴)');
  assert.equal(status.estimated, false);
  assert.equal(status.paysOff, true);
  assert.ok(status.payoffDate > '2050-01-01' && status.payoffDate < '2052-01-01', status.payoffDate);
  // 1년 뒤에는 12번 갚아 남은 원금이 줄어 있다
  const later = loanStatus(mortgage, { today: '2027-11-30' });
  assert.equal(later.estimated, true);
  assert.ok(later.balance < 230_000_000 - 12 * 445_000, `${later.balance}`);
  assert.ok(later.next.interest < status.next.interest, '원금이 줄면 이자 몫도 준다');
});

test('원리금균등: 매달 금액 대신 만기만 적으면 매달 금액을 거꾸로 계산하고, 둘이 크게 다르면 알린다', () => {
  const byMaturity = { ...mortgage, monthlyPayment: null, maturity: '2051-10' };
  const schedule = loanSchedule(byMaturity);
  assert.equal(schedule.payments.length, 300, '2026-11 ~ 2051-10: 300번');
  near(schedule.perMonth, equalPaymentAmount(230_000_000, 4.2, 300), 0.01);
  near(schedule.perMonth, 1_239_500, 1_000, '약 124만원');
  assert.equal(schedule.payments[schedule.payments.length - 1].balance, 0);
  assert.equal(paymentMismatch({ ...mortgage, maturity: '2051-10' }), null, '125만원이면 1% 안쪽');
  const off = paymentMismatch({ ...mortgage, monthlyPayment: 1_500_000, maturity: '2051-10' });
  assert.ok(off && off.gap > 0.05);
});

test('원리금균등: 매달 금액이 이자보다 적으면 원금이 줄지 않는다고 알린다', () => {
  const schedule = loanSchedule({ ...mortgage, monthlyPayment: 800_000 });
  assert.equal(schedule.error, 'too-small');
  assert.equal(schedule.paysOff, false);
  const result = validateLoan({ name: '집', type: '주택담보대출', method: 'equalPayment', balance: '230000000', rate: '4.2', baseDate: '2026-11-03', monthlyPayment: '800000' });
  assert.equal(result.ok, false);
  assert.match(result.errors.monthlyPayment, /이자\(약 805,000원\)보다 적거나 같아서/);
});

test('원금균등: 매달 같은 원금, 내는 돈은 점점 준다', () => {
  const loan = { balance: 100_000_000, rate: 3.6, method: 'equalPrincipal', baseDate: '2026-01-10', maturity: '2035-12' };
  const schedule = loanSchedule(loan);
  assert.equal(schedule.payments.length, 119, '2026-02 ~ 2035-12');
  near(schedule.perMonth, 100_000_000 / 119, 0.01);
  assert.ok(schedule.payments[1].payment < schedule.payments[0].payment);
  near(schedule.payments[0].interest, 300_000, 0.01, '1억 × 3.6% / 12');
  const status = loanStatus(loan, { today: '2026-11-03' });
  near(status.balance, 100_000_000 - 9 * (100_000_000 / 119), 0.01, '2~10월 9번 갚음');
});

test('만기일시: 매달 이자만, 만기 달에 원금을 한꺼번에', () => {
  const loan = { balance: 50_000_000, rate: 5, method: 'bullet', baseDate: '2026-01-10', maturity: '2027-01' };
  const schedule = loanSchedule(loan);
  assert.equal(schedule.payments.length, 12);
  assert.ok(schedule.payments.slice(0, -1).every((payment) => payment.principal === 0));
  const last = schedule.payments[schedule.payments.length - 1];
  assert.equal(last.date, '2027-01-10');
  assert.equal(last.principal, 50_000_000);
  const status = loanStatus(loan, { today: '2026-11-03' });
  assert.equal(status.balance, 50_000_000);
  near(status.next.payment, 208_333.33, 0.01);
  assert.equal(status.payoffDate, '2027-01-10');
  // 만기가 없으면 끝없이 이자만 (못 갚음으로 표시)
  assert.equal(loanSchedule({ ...loan, maturity: null }).paysOff, false);
});

test('갚는 날: 그 달에 없는 날짜면 마지막 날, 안 적으면 기준일과 같은 날, 다 갚으면 남은 원금 0', () => {
  const schedule = loanSchedule({ balance: 3_000_000, rate: 0, method: 'equalPayment', baseDate: '2026-01-15', monthlyPayment: 1_000_000, payDay: 31 });
  assert.deepEqual(schedule.payments.map((payment) => payment.date), ['2026-01-31', '2026-02-28', '2026-03-31']);
  const noDay = loanSchedule({ balance: 2_000_000, rate: 0, method: 'equalPayment', baseDate: '2026-01-15', monthlyPayment: 1_000_000 });
  assert.deepEqual(noDay.payments.map((payment) => payment.date), ['2026-02-15', '2026-03-15']);
  const done = loanStatus({ balance: 2_000_000, rate: 0, method: 'equalPayment', baseDate: '2026-01-15', monthlyPayment: 1_000_000 }, { today: '2026-05-01' });
  assert.equal(done.balance, 0);
  assert.equal(done.finished, true);
  assert.equal(done.next, null);
});

test('여러 대출 합계: 오늘 남은 원금, 이번 회차 원금·이자, 가장 늦게 다 갚는 날', () => {
  const summary = loansSummary([
    mortgage,
    { balance: 10_000_000, rate: 6, method: 'equalPrincipal', baseDate: '2026-11-01', monthlyPayment: 500_000, payDay: 10 },
  ], { today: '2026-11-03' });
  assert.equal(summary.balance, 240_000_000);
  near(summary.monthlyInterest, 805_000 + 50_000, 0.01);
  near(summary.monthlyPrincipal, 445_000 + 500_000, 0.01);
  near(summary.monthlyPayment, 1_250_000 + 550_000, 0.01);
  assert.ok(summary.lastPayoffDate > '2050-01-01');
  assert.deepEqual(summary.neverPaysOff, []);
  assert.equal(loansSummary([]).balance, 0);
});

test('입력 검사: 필요한 값, 방식별로 매달 금액이나 만기, 만기일시는 만기 필수', () => {
  const base = { name: '집 담보대출', type: '주택담보대출', method: 'equalPayment', balance: '230,000,000', rate: '4.2', baseDate: '2026-11-03', payDay: '25' };
  const ok = validateLoan({ ...base, monthlyPayment: '1,250,000' }, { now: new Date('2026-11-03T10:00:00') });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.balance, 230_000_000);
  assert.equal(ok.value.monthlyPayment, 1_250_000);
  assert.equal(ok.value.payDay, 25);
  assert.equal(ok.value.updatedAt, '2026-11-03');
  assert.deepEqual(loanToInput(ok.value).balance, '230000000');

  assert.match(validateLoan({ ...base }).errors.monthlyPayment, /매월 상환액이나 만기/);
  assert.equal(validateLoan({ ...base, maturity: '2051-10' }).ok, true, '만기만 적어도 됨');
  assert.match(validateLoan({ ...base, method: 'equalPrincipal' }).errors.monthlyPayment, /매달 갚는 원금이나 만기/);
  assert.match(validateLoan({ ...base, method: 'bullet', monthlyPayment: '100' }).errors.maturity, /만기가 있어야/);
  const bullet = validateLoan({ ...base, method: 'bullet', maturity: '2028-01', monthlyPayment: '999' });
  assert.equal(bullet.ok, true);
  assert.equal(bullet.value.monthlyPayment, null, '만기일시는 매달 금액을 쓰지 않음');
  const bad = validateLoan({ name: '', type: '주택담보대출', method: 'equalPayment', balance: '0', rate: '50', baseDate: '', monthlyPayment: '1000000' });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['balance', 'baseDate', 'name', 'rate']);
  assert.match(validateLoan({ ...base, maturity: '2020-01' }).errors.maturity, /기준일보다 앞/);
  const warned = validateLoan({ ...base, monthlyPayment: '1500000', maturity: '2051-10' });
  assert.equal(warned.ok, true);
  assert.match(warned.warnings.monthlyPayment, /만기에 맞추려면 매월 약/);
});

test('저장 데이터 정리: 대출·부동산 기본값, 이상한 값은 버림, 예전 데이터에는 빈 목록', () => {
  const loan = normalizeLoan({ name: 'A', method: 'bullet', balance: 1000, rate: 99, monthlyPayment: 5, payDay: 40 });
  assert.equal(loan.method, 'bullet');
  assert.equal(loan.rate, 0);
  assert.equal(loan.monthlyPayment, null);
  assert.equal(loan.payDay, null);
  assert.match(loan.id, /^l/);
  const house = normalizeRealEstate({ name: '우리 집', kind: '이상한값', value: 600_000_000 });
  assert.equal(house.kind, '아파트');
  assert.equal(realEstateTotal([house, { value: -1 }]), 600_000_000);
  const data = normalizeData({ holdings: [] });
  assert.equal(data.settings.totalIncludesRealEstate, false, '총자산에 부동산은 기본으로 빼고');
  assert.equal(normalizeData({ settings: { totalIncludesRealEstate: true } }).settings.totalIncludesRealEstate, true);
  assert.deepEqual(data.loans, []);
  assert.deepEqual(data.realEstate, []);
  const kept = normalizeData({ loans: [{ name: 'A', balance: 1, rate: 1, method: 'equalPayment' }, 'x'], realEstate: [{ name: 'B', value: 1 }] });
  assert.equal(kept.loans.length, 1);
  assert.equal(kept.realEstate.length, 1);
});

test('부동산 입력 검사', () => {
  const ok = validateRealEstate({ name: '우리 집', kind: '아파트', value: '6억', baseDate: '2026-11-03' });
  assert.equal(ok.ok, false, '"6억"은 숫자가 아님');
  const good = validateRealEstate({ name: '우리 집', kind: '아파트', value: '600,000,000', baseDate: '2026-11-03' }, { now: new Date('2026-11-03T09:00:00') });
  assert.equal(good.ok, true);
  assert.equal(good.value.value, 600_000_000);
  assert.deepEqual(Object.keys(validateRealEstate({}).errors).sort(), ['baseDate', 'kind', 'name', 'value']);
});
