import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  annuityPayment, coverageYears, incomeGap, incomeTimeline, planPension, projectOtherAsset, projectStocks,
  retirementProjection, simulateSavings, toFutureValue, toPresentValue, valueAt, yearlySamples,
} from '../js/calc/projection.js';
import { monthIndexOf, toYearMonth } from '../js/dates.js';

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-4, `${message ?? ''} ${actual} ≠ ${expected}`);

const START = monthIndexOf(2026, 1);
const at = (points, offset) => valueAt(points, START + offset);
const savings = (options) => simulateSavings({ startMonth: START, endMonth: START + 24, ...options });

test('월복리: 매달 이자가 붙는다 (연 12% → 월 1%)', () => {
  const points = savings({ balance: 1_000_000, annualRate: 12 });
  near(at(points, 12).balance, 1_000_000 * 1.01 ** 12);
  near(at(points, 0).balance, 1_000_000);
});

test('연복리: 12개월마다 이자가 붙고, 그 사이에는 쌓인 이자를 함께 보여준다', () => {
  const points = savings({ balance: 1_000_000, annualRate: 12, compounding: '연복리' });
  near(at(points, 12).balance, 1_120_000);
  near(at(points, 24).balance, 1_254_400);
  near(at(points, 6).balance, 1_060_000);
});

test('단리: 넣은 돈에만 이자가 붙는다', () => {
  const points = savings({ balance: 1_000_000, annualRate: 12, compounding: '단리' });
  near(at(points, 24).balance, 1_240_000);
  near(at(points, 24).interest, 240_000);
});

test('지금까지 붙은 이자를 알면 원금과 이자를 나눠서 시작한다', () => {
  // 적립금 1,000만원 중 이자 200만원: 단리는 원금 800만원에만 이자가 붙는다
  const simple = savings({ balance: 10_000_000, accruedInterest: 2_000_000, annualRate: 12, compounding: '단리' });
  near(at(simple, 0).principal, 8_000_000);
  near(at(simple, 0).interest, 2_000_000);
  near(at(simple, 12).interest, 2_000_000 + 8_000_000 * 0.01 * 12);
  // 복리는 이자에도 이자가 붙으므로 적립금 전체가 불어난다
  const monthly = savings({ balance: 10_000_000, accruedInterest: 2_000_000, annualRate: 12 });
  near(at(monthly, 12).balance, 10_000_000 * 1.01 ** 12);
  near(at(monthly, 12).principal, 8_000_000);
  near(at(monthly, 12).interest, 10_000_000 * 1.01 ** 12 - 8_000_000);
});

test('매달 납입(월말): 원금과 이자를 나눠 보여준다', () => {
  const points = savings({ monthlyContribution: 100_000, annualRate: 12, contributionEndMonth: START + 24 });
  const fv = (100_000 * (1.01 ** 12 - 1)) / 0.01;
  near(at(points, 12).balance, fv);
  near(at(points, 12).principal, 1_200_000);
  near(at(points, 12).interest, fv - 1_200_000);
});

test('납입액 증액률: 12개월마다 납입액이 오른다', () => {
  const points = savings({ monthlyContribution: 100_000, growthRate: 10, contributionEndMonth: START + 24 });
  near(at(points, 24).principal, 1_200_000 + 1_320_000);
});

test('납입 종료 후 수령 전까지는 이자만 붙는다', () => {
  const points = savings({ monthlyContribution: 100_000, annualRate: 12, contributionEndMonth: START + 12, payoutMonth: START + 24 });
  near(at(points, 24).principal, 1_200_000);
  near(at(points, 24).balance, ((100_000 * (1.01 ** 12 - 1)) / 0.01) * 1.01 ** 12);
});

test('수령 달이 지나면 받은 돈을 그대로 들고 있다 (이자 없음)', () => {
  const points = savings({ balance: 1_000_000, annualRate: 12, payoutMonth: START + 12 });
  near(at(points, 24).balance, at(points, 12).balance);
});

test('경계: 납입 종료일이 기준일보다 과거면 납입 없음', () => {
  const points = savings({ balance: 1_000_000, monthlyContribution: 100_000, contributionEndMonth: START - 3 });
  near(at(points, 24).principal, 1_000_000);
});

test('경계: 수령일이 납입 종료일보다 이전이면 수령 때까지만 납입', () => {
  const points = savings({ monthlyContribution: 100_000, contributionEndMonth: START + 12, payoutMonth: START + 6 });
  near(at(points, 24).principal, 600_000);
});

test('연복리: 해의 중간에 수령하면 그때까지 쌓인 이자를 붙여 준다', () => {
  const points = savings({ balance: 1_000_000, annualRate: 12, compounding: '연복리', payoutMonth: START + 6 });
  near(at(points, 6).balance, 1_060_000);
  near(at(points, 24).balance, 1_060_000);
});

test('수익률 0%: 원금 그대로', () => {
  const points = savings({ balance: 500_000, monthlyContribution: 10_000, contributionEndMonth: START + 10 });
  near(at(points, 24).balance, 600_000);
  near(at(points, 24).interest, 0);
});

test('그래프용 표본: 시작 달, 해마다 12월, 마지막 달', () => {
  const points = simulateSavings({ startMonth: monthIndexOf(2026, 3), endMonth: monthIndexOf(2028, 6), balance: 1 });
  assert.deepEqual(yearlySamples(points).map((point) => toYearMonth(point.month)), ['2026-03', '2026-12', '2027-12', '2028-06']);
});

test('공제회·예적금: 시나리오 3개를 각각 계산한다', () => {
  const asset = {
    balance: 10_000_000, baseDate: '2026-01-15', monthlyContribution: 0, contributionGrowthRate: 0,
    interestRates: { low: 0, base: 12, high: 24 }, compounding: '월복리', contributionEndDate: null, payoutDate: '2027-01',
  };
  const projection = projectOtherAsset(asset, { nowMonth: START, endMonth: START + 12 });
  near(valueAt(projection.low, START + 12).balance, 10_000_000);
  near(valueAt(projection.base, START + 12).balance, 10_000_000 * 1.01 ** 12);
  near(valueAt(projection.high, START + 12).balance, 10_000_000 * 1.02 ** 12);
});

test('공제회·예적금 세금: 원금은 그대로 두고 이자에서만 세금을 뺀다', () => {
  const asset = {
    balance: 10_000_000, baseDate: '2026-01-15', monthlyContribution: 0, contributionGrowthRate: 0,
    interestRates: { low: -2, base: 12, high: 12 }, compounding: '월복리', contributionEndDate: null, payoutDate: '2027-01',
    applyTax: true, taxRate: 15.4,
  };
  const interest = 10_000_000 * (1.01 ** 12 - 1);
  const taxed = valueAt(projectOtherAsset(asset, { nowMonth: START, endMonth: START + 12 }).base, START + 12);
  near(taxed.principal, 10_000_000);
  near(taxed.interest, interest);
  near(taxed.tax, interest * 0.154);
  near(taxed.balance, 10_000_000 + interest * (1 - 0.154));
  // 끄면 세금 0, 세율을 바꾸면 그 세율로
  const untaxed = valueAt(projectOtherAsset({ ...asset, applyTax: false }, { nowMonth: START, endMonth: START + 12 }).base, START + 12);
  assert.equal(untaxed.tax, 0);
  near(untaxed.balance, 10_000_000 + interest);
  near(valueAt(projectOtherAsset({ ...asset, taxRate: 3 }, { nowMonth: START, endMonth: START + 12 }).base, START + 12).tax, interest * 0.03);
  // 이자가 마이너스면 세금은 없다
  assert.equal(valueAt(projectOtherAsset(asset, { nowMonth: START, endMonth: START + 12 }).low, START + 12).tax, 0);
});

test('공제회·예적금 세금: 지금까지 붙은 이자를 넣으면 그 이자에도 세금을 매긴다', () => {
  const asset = {
    balance: 10_000_000, accruedInterest: 2_000_000, baseDate: '2026-01-15', monthlyContribution: 0, contributionGrowthRate: 0,
    interestRates: { low: 12, base: 12, high: 12 }, compounding: '월복리', contributionEndDate: null, payoutDate: '2027-01',
    applyTax: true, taxRate: 3,
  };
  const point = valueAt(projectOtherAsset(asset, { nowMonth: START, endMonth: START + 12 }).base, START + 12);
  const totalInterest = 10_000_000 * 1.01 ** 12 - 8_000_000;
  near(point.tax, totalInterest * 0.03);
  near(point.balance, 8_000_000 + totalInterest * 0.97);
});

test('원리금균등 월 수령액 (r = 0이면 적립금 / n)', () => {
  near(annuityPayment(120_000_000, 0, 240), 500_000);
  const r = 0.005;
  near(annuityPayment(120_000_000, 6, 240), (120_000_000 * r) / (1 - (1 + r) ** -240));
  assert.equal(annuityPayment(0, 6, 120), 0);
  assert.equal(annuityPayment(1_000, 6, 0), 0);
});

test('현재가치 = 미래 금액 / (1 + 물가상승률)^연수', () => {
  near(toPresentValue(1_000_000, 120, 2.5), 1_000_000 / 1.025 ** 10);
  near(toFutureValue(1_000_000, 120, 2.5), 1_000_000 * 1.025 ** 10);
  assert.equal(toPresentValue(1_000_000, -12, 2.5), 1_000_000);
});

test('주식: 매달 투자액을 더하며 기대 수익률로 월복리', () => {
  near(projectStocks({ value: 10_000_000, annualReturn: 12, months: 12 }), 10_000_000 * 1.01 ** 12);
  near(projectStocks({ value: 10_000_000, monthlyInvestment: 100_000, annualReturn: 0, months: 12 }), 11_200_000);
  assert.equal(projectStocks({ value: 5, annualReturn: 5, months: 0 }), 5);
});

const PERSON = { birthYear: 1970, birthMonth: 1, lifeExpectancy: 90, nowMonth: START, inflationRate: 2.5, taxRate: 5.5 };
const fixed = (overrides) => ({
  id: 'f', name: '공무원연금', kind: 'fixed', startAge: 65, payoutType: '종신', payoutYears: null, applyTax: true,
  expectedMonthlyAmount: 2_000_000, amountBasis: 'present', inflationIndexed: true, ...overrides,
});

test('확정 수령형(현재가치 기준 금액): 받기 시작할 때 실제 금액으로 키우고, 세금을 뺀다', () => {
  const plan = planPension(fixed(), PERSON);
  assert.equal(toYearMonth(plan.startMonth), '2035-01');
  near(plan.startAmount.base, 2_000_000 * 1.025 ** 9 * 0.945);
  // 지금 돈 가치로 바꾸면 조회 금액(세후)과 같다
  near(toPresentValue(plan.startAmount.base, plan.startMonth - START, 2.5), 2_000_000 * 0.945);
  // 물가연동: 1년 뒤에는 물가만큼 오른다
  near(plan.monthlyAt(plan.startMonth + 12), plan.startAmount.base * 1.025);
  assert.equal(plan.monthlyAt(plan.startMonth - 1), 0);
});

test('연금 세율: 연금마다 정한 세율을 쓰고, 없으면 설정의 기본값', () => {
  const own = planPension(fixed({ taxRate: 3.3 }), PERSON);
  near(toPresentValue(own.startAmount.base, own.startMonth - START, 2.5), 2_000_000 * 0.967);
  const fallback = planPension(fixed(), PERSON); // taxRate 없음 → PERSON.taxRate 5.5
  near(toPresentValue(fallback.startAmount.base, fallback.startMonth - START, 2.5), 2_000_000 * 0.945);
});

test('확정 수령형(미래 금액 기준): 그대로 쓰고, 현재가치는 물가로 할인', () => {
  const plan = planPension(fixed({ amountBasis: 'future', inflationIndexed: false, applyTax: false }), PERSON);
  near(plan.startAmount.base, 2_000_000);
  near(plan.monthlyAt(plan.startMonth + 60), 2_000_000);
  near(toPresentValue(plan.startAmount.base, plan.startMonth - START, 2.5), 2_000_000 / 1.025 ** 9);
});

test('종신은 기대 수명까지, 기간 지정은 그 기간만큼 받는다', () => {
  const lifetime = planPension(fixed(), PERSON);
  assert.equal(lifetime.months, 25 * 12);
  assert.equal(lifetime.lifetimeAssumed, true);
  assert.equal(lifetime.monthlyAt(lifetime.endMonth), 0);
  const term = planPension(fixed({ payoutType: '기간 지정', payoutYears: 20 }), PERSON);
  assert.equal(term.months, 240);
  assert.equal(term.lifetimeAssumed, false);
});

test('수령 개시 연령이 이미 지난 연금: 지금부터 남은 기간만 받는다', () => {
  const plan = planPension(fixed({ payoutType: '기간 지정', payoutYears: 20 }), { ...PERSON, birthYear: 1950 });
  assert.equal(plan.startMonth, START);
  assert.equal(plan.months, monthIndexOf(2035, 1) - START);
  assert.match(plan.warnings.join(), /이미 받기 시작한/);
  const ended = planPension(fixed({ payoutType: '기간 지정', payoutYears: 5 }), { ...PERSON, birthYear: 1950 });
  assert.equal(ended.months, 0);
  assert.equal(ended.monthlyAt(START), 0);
});

const accumulating = (overrides) => ({
  id: 'a', name: '연금저축', kind: 'accumulating', startAge: 65, payoutType: '기간 지정', payoutYears: 10, applyTax: false,
  linkedAccount: null, balance: 10_000_000, baseDate: '2026-01-01', monthlyContribution: 0, contributionEndDate: null,
  expectedReturns: { low: 0, base: 0, high: 0 }, ...overrides,
});

test('적립형: 수령 시작까지 굴린 적립금을 원리금균등으로 나눠 받는다 (수익률 0%)', () => {
  const plan = planPension(accumulating(), PERSON);
  near(plan.balanceAtStart.base, 10_000_000);
  near(plan.startAmount.base, 10_000_000 / 120);
  near(plan.monthlyAt(plan.startMonth + 119), 10_000_000 / 120);
  assert.equal(plan.monthlyAt(plan.startMonth + 120), 0);
});

test('적립형: 수익률이 있으면 적립 중에도, 받는 중에도 붙는다', () => {
  const plan = planPension(accumulating({ expectedReturns: { low: 3, base: 6, high: 9 }, applyTax: true }), PERSON);
  const balance = 10_000_000 * 1.005 ** 108;
  near(plan.balanceAtStart.base, balance);
  near(plan.startAmount.base, annuityPayment(balance, 6, 120) * 0.945);
  assert.ok(plan.startAmount.low < plan.startAmount.base && plan.startAmount.base < plan.startAmount.high);
});

test('적립형 계좌 연결: 그 계좌 보유 종목 금액을 적립금으로, 종목이 없으면 0원과 안내', () => {
  const linked = planPension(accumulating({ linkedAccount: 'IRP', balance: 0, baseDate: null }), { ...PERSON, linkedBalance: 6_000_000 });
  near(linked.balanceAtStart.base, 6_000_000);
  const empty = planPension(accumulating({ linkedAccount: 'IRP', balance: 0, baseDate: null }), { ...PERSON, linkedBalance: 0 });
  assert.equal(empty.startAmount.base, 0);
  assert.match(empty.warnings.join(), /IRP 계좌에 보유 종목이 없어서/);
});

test('은퇴 후 월 소득 타임라인: 나이마다 연금별 월 수령액이 쌓인다', () => {
  const plans = [
    planPension(fixed({ id: 'f', startAge: 62, amountBasis: 'future', inflationIndexed: false, applyTax: false }), PERSON),
    planPension(accumulating({ id: 'a', startAge: 65 }), PERSON),
  ];
  const timeline = incomeTimeline(plans, { ...PERSON, fromAge: 60, toAge: 76, view: 'future' });
  assert.deepEqual(timeline.ages.slice(0, 3), [60, 61, 62]);
  const [publicPension, savingsPension] = timeline.series;
  assert.deepEqual(publicPension.values.slice(0, 3), [0, 0, 2_000_000]);
  near(savingsPension.values[5], 10_000_000 / 120); // 65세
  assert.equal(savingsPension.values[15], 0); // 75세: 10년 수령이 끝남
  const present = incomeTimeline(plans, { ...PERSON, fromAge: 62, toAge: 62, view: 'present' });
  near(present.series[0].values[0], 2_000_000 / 1.025 ** 6);
  assert.deepEqual(incomeTimeline([], { ...PERSON, fromAge: 60, toAge: 61 }).series, []);
});

test('소득 공백기: 퇴직부터 가장 먼저 시작하는 연금까지 (없으면 0)', () => {
  const plans = [planPension(fixed({ startAge: 67 }), PERSON), planPension(fixed({ startAge: 65 }), PERSON)];
  const retirement = monthIndexOf(2030, 1); // 60세
  assert.deepEqual(incomeGap(plans, retirement), { firstStartMonth: monthIndexOf(2035, 1), gapMonths: 60 });
  assert.equal(incomeGap(plans, monthIndexOf(2036, 1)).gapMonths, 0);
  assert.deepEqual(incomeGap([], retirement), { firstStartMonth: null, gapMonths: null });
});

test('감당 가능 연수 = 기타 금융자산 / (월 목표 생활비 × 12)', () => {
  assert.equal(coverageYears(72_000_000, 3_000_000), 2);
  assert.equal(coverageYears(72_000_000, 0), null);
  assert.equal(coverageYears(72_000_000, null), null);
});

test('퇴직 시점 종합: 주식 시나리오, 공제회·예적금 합계(퇴직 전 수령분은 그대로)', () => {
  const retirementMonth = START + 24;
  const otherAssets = [
    { type: '공제회', balance: 10_000_000, baseDate: '2026-01-01', monthlyContribution: 0, contributionGrowthRate: 0, interestRates: { low: 0, base: 12, high: 12 }, compounding: '월복리', contributionEndDate: null, payoutDate: '2030-01' },
    { type: '예금', balance: 5_000_000, baseDate: '2026-01-01', monthlyContribution: 0, contributionGrowthRate: 0, interestRates: { low: 12, base: 12, high: 12 }, compounding: '월복리', contributionEndDate: null, payoutDate: '2027-01' },
  ];
  const result = retirementProjection({
    stockValue: 10_000_000, monthlyInvestment: 0, stockReturns: { low: 0, base: 12, high: 24 }, otherAssets, plans: [], retirementMonth, nowMonth: START,
  });
  near(result.stocks.low, 10_000_000);
  near(result.stocks.base, 10_000_000 * 1.01 ** 24);
  near(result.deposits.byType.공제회, 10_000_000 * 1.01 ** 24);
  near(result.deposits.byType.예금, 5_000_000 * 1.01 ** 12); // 1년 뒤 받은 돈을 그대로 들고 있음
  near(result.deposits.low, 10_000_000 + 5_000_000 * 1.01 ** 12);
  assert.equal(result.pensionTotal, 0);

  // 세금 빼기를 켠 항목은 세후 금액으로 더한다
  const taxed = retirementProjection({
    stockValue: 0, monthlyInvestment: 0, stockReturns: { low: 0, base: 0, high: 0 },
    otherAssets: [{ ...otherAssets[1], applyTax: true, taxRate: 15.4 }], plans: [], retirementMonth, nowMonth: START,
  });
  near(taxed.deposits.base, 5_000_000 + 5_000_000 * (1.01 ** 12 - 1) * (1 - 0.154));
});
