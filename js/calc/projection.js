// 미래 예측 (요청서 6-6 ~ 6-9). 모든 계산은 '달' 단위다 (달 번호는 dates.js 참고).

import { monthIndexAtAge, parseMonth, yearOf } from '../dates.js';

export const SCENARIOS = Object.freeze(['low', 'base', 'high']);

// ── 현재가치 (6-8) ─────────────────────────────
// 현재가치 = 미래 금액 / (1 + 물가상승률)^(경과 연수)
export function toPresentValue(amount, monthsFromNow, inflationRate) {
  return amount / (1 + inflationRate / 100) ** (Math.max(0, monthsFromNow) / 12);
}

export function toFutureValue(amount, monthsFromNow, inflationRate) {
  return amount * (1 + inflationRate / 100) ** (Math.max(0, monthsFromNow) / 12);
}

// ── 적립 시뮬레이션 (6-6) ─────────────────────────
// 기준 달의 적립금에서 시작해 한 달씩 이자를 붙이고, 매달 말에 납입한다.
//  월복리: 매달 이자가 적립금에 붙는다
//  연복리: 달마다 이자를 계산해 두었다가 기준 달로부터 12개월마다(그리고 수령 때) 붙인다
//  단리: 넣은 돈(원금)에만 이자가 붙는다
// 납입 종료 달까지 납입하고(증액률이 있으면 12개월마다 증액), 그 뒤 수령 달까지는 이자만 붙는다.
// 수령 달이 지나면 받은 돈을 그대로 들고 있다고 보고 이자를 더 붙이지 않는다.
// balance는 기준 달의 적립금, accruedInterest는 그중 이미 붙은 이자 (나머지가 원금)
// 돌려주는 값: 기준 달부터 endMonth까지 달마다 { month, principal(넣은 돈), interest(이자), balance }
export function simulateSavings({
  startMonth,
  endMonth,
  balance = 0,
  accruedInterest = 0,
  monthlyContribution = 0,
  growthRate = 0,
  annualRate = 0,
  compounding = '월복리',
  contributionEndMonth = null,
  payoutMonth = null,
}) {
  const rate = annualRate / 100 / 12;
  const stopMonth = payoutMonth ?? Infinity;
  const lastContribution = Math.min(contributionEndMonth ?? stopMonth, stopMonth);
  let interest = Math.min(Math.max(0, accruedInterest), balance);
  let principal = balance - interest;
  let pending = 0;
  let contribution = monthlyContribution;
  const points = [{ month: startMonth, principal, interest, balance }];

  for (let month = startMonth + 1; month <= endMonth; month += 1) {
    if (month <= stopMonth) {
      const opening = principal + interest;
      if (compounding === '단리') interest += principal * rate;
      else if (compounding === '연복리') pending += opening * rate;
      else interest += opening * rate;

      if (month <= lastContribution) principal += contribution;

      const elapsed = month - startMonth;
      if (compounding === '연복리' && (elapsed % 12 === 0 || month === stopMonth)) {
        interest += pending;
        pending = 0;
      }
      if (elapsed % 12 === 0 && growthRate) contribution *= 1 + growthRate / 100;
    }
    points.push({ month, principal, interest: interest + pending, balance: principal + interest + pending });
  }
  return points;
}

// 그 달의 값 (범위 밖이면 처음·마지막 값)
export function valueAt(points, month) {
  if (month <= points[0].month) return points[0];
  const last = points[points.length - 1];
  if (month >= last.month) return last;
  return points[month - points[0].month];
}

// 그래프용: 시작 달, 해마다 12월, 마지막 달
export function yearlySamples(points) {
  const first = points[0];
  const last = points[points.length - 1];
  const samples = [first];
  for (let year = yearOf(first.month); year <= yearOf(last.month); year += 1) {
    const december = year * 12 + 11;
    if (december > first.month && december < last.month) samples.push(valueAt(points, december));
  }
  if (last.month > first.month) samples.push(last);
  return samples;
}

// 세금을 빼기로 한 항목은 그때까지 붙은 이자 전체(기준일까지 붙은 이자 + 그 뒤 이자)에서
// 세금을 뺀다 (받을 때 한꺼번에 떼는 것으로 단순화).
function withInterestTax(points, taxRate) {
  const share = taxRate / 100;
  return points.map((point) => {
    const tax = Math.max(0, point.interest) * share;
    return { ...point, tax, balance: point.balance - tax };
  });
}

// 공제회·예적금 하나의 시나리오별 예측. endMonth는 그래프·퇴직 시점 계산에 필요한 마지막 달.
// 시나리오마다 달별 { month, principal, interest(세전 이자), tax, balance(세금을 뺀 금액) }
export function projectOtherAsset(asset, { nowMonth, endMonth }) {
  const startMonth = parseMonth(asset.baseDate) ?? nowMonth;
  const payoutMonth = parseMonth(asset.payoutDate);
  const contributionEndMonth = parseMonth(asset.contributionEndDate);
  const lastMonth = Math.max(endMonth, payoutMonth ?? startMonth, startMonth);
  const taxRate = asset.applyTax ? asset.taxRate ?? 0 : 0;
  const result = { startMonth, payoutMonth, contributionEndMonth };
  for (const scenario of SCENARIOS) {
    result[scenario] = withInterestTax(simulateSavings({
      startMonth,
      endMonth: lastMonth,
      balance: asset.balance,
      accruedInterest: asset.accruedInterest ?? 0,
      monthlyContribution: asset.monthlyContribution,
      growthRate: asset.contributionGrowthRate,
      annualRate: asset.interestRates[scenario],
      compounding: asset.compounding,
      contributionEndMonth,
      payoutMonth,
    }), taxRate);
  }
  return result;
}

// ── 주식 ─────────────────────────────────────
// 지금 평가금액에 매달 투자액을 더하고, 기대 수익률로 월복리
export function projectStocks({ value, monthlyInvestment = 0, annualReturn, months }) {
  const rate = annualReturn / 100 / 12;
  let result = value;
  for (let i = 0; i < months; i += 1) result = result * (1 + rate) + monthlyInvestment;
  return result;
}

// ── 연금 (6-7) ───────────────────────────────
// 원리금균등: 월 수령액 = 적립금 × r / (1 − (1 + r)^(−n)), r = 월 수익률, n = 수령 개월 수, r = 0이면 적립금 / n
export function annuityPayment(balance, annualRate, months) {
  if (!(months > 0) || !(balance > 0)) return 0;
  const rate = annualRate / 100 / 12;
  if (rate === 0) return balance / months;
  return (balance * rate) / (1 - (1 + rate) ** -months);
}

// 연금 하나의 수령 계획.
//  startMonth: 받기 시작하는 달 (이미 지났으면 지금 달), endMonth: 받기가 끝나는 달 (이 달부터는 0)
//  startAmount[시나리오]: 받기 시작할 때 월 수령액 (그때의 실제 금액, 세금을 빼기로 했으면 세후)
//  monthlyAt(달, 시나리오): 그 달에 받는 실제 금액. 물가연동 확정 수령형은 해마다 물가만큼 오른다.
//  종신은 설정의 기대 수명까지 받는다고 본다 (lifetimeAssumed).
//  세율은 연금마다 정한 값(pension.taxRate), 없으면 options.taxRate(설정의 기본값)
export function planPension(pension, {
  birthYear, birthMonth = 1, lifeExpectancy, nowMonth, inflationRate, taxRate, linkedBalance = 0,
}) {
  const warnings = [];
  const scheduledStart = monthIndexAtAge(pension.startAge, birthYear, birthMonth);
  const alreadyStarted = scheduledStart < nowMonth;
  const startMonth = Math.max(scheduledStart, nowMonth);
  const lifetime = pension.payoutType !== '기간 지정';
  const endMonth = lifetime
    ? Math.max(monthIndexAtAge(lifeExpectancy, birthYear, birthMonth), startMonth)
    : scheduledStart + pension.payoutYears * 12;
  const months = Math.max(0, endMonth - startMonth);
  const keep = pension.applyTax ? 1 - (pension.taxRate ?? taxRate) / 100 : 1;
  if (alreadyStarted) warnings.push('이미 받기 시작한 나이라 지금부터 받는다고 계산했어요.');
  if (months === 0) warnings.push('받는 기간이 이미 끝났어요.');

  const plan = {
    id: pension.id,
    name: pension.name,
    kind: pension.kind,
    scheduledStart,
    startMonth,
    endMonth,
    months,
    lifetimeAssumed: lifetime,
    taxed: pension.applyTax,
    warnings,
  };
  const inRange = (month) => months > 0 && month >= startMonth && month < endMonth;

  if (pension.kind === 'fixed') {
    // 조회 금액 → 받기 시작할 때의 실제 금액
    let startNominal = pension.amountBasis === 'future'
      ? pension.expectedMonthlyAmount
      : toFutureValue(pension.expectedMonthlyAmount, startMonth - nowMonth, inflationRate);
    if (pension.amountBasis === 'future' && alreadyStarted && pension.inflationIndexed) {
      startNominal = toFutureValue(startNominal, nowMonth - scheduledStart, inflationRate);
    }
    const amount = startNominal * keep;
    plan.indexed = pension.inflationIndexed;
    plan.startAmount = { low: amount, base: amount, high: amount };
    plan.monthlyAt = (month) => {
      if (!inRange(month)) return 0;
      return pension.inflationIndexed ? toFutureValue(amount, month - startMonth, inflationRate) : amount;
    };
    return plan;
  }

  // 적립형: 받기 시작할 때까지 굴린 적립금을 받는 기간 동안 원리금균등으로 나눠 받는다
  const linked = Boolean(pension.linkedAccount);
  const fromMonth = linked ? nowMonth : (parseMonth(pension.baseDate) ?? nowMonth);
  const balance = linked ? linkedBalance : pension.balance;
  if (linked && !(linkedBalance > 0)) {
    warnings.push(`연결한 ${pension.linkedAccount} 계좌에 보유 종목이 없어서 적립금을 0원으로 계산했어요.`);
  }
  plan.indexed = false;
  plan.balanceAtStart = {};
  plan.startAmount = {};
  for (const scenario of SCENARIOS) {
    const points = simulateSavings({
      startMonth: fromMonth,
      endMonth: Math.max(startMonth, fromMonth),
      balance,
      monthlyContribution: pension.monthlyContribution,
      annualRate: pension.expectedReturns[scenario],
      compounding: '월복리',
      contributionEndMonth: parseMonth(pension.contributionEndDate),
      payoutMonth: startMonth,
    });
    plan.balanceAtStart[scenario] = points[points.length - 1].balance;
    plan.startAmount[scenario] = annuityPayment(plan.balanceAtStart[scenario], pension.expectedReturns[scenario], months) * keep;
  }
  plan.monthlyAt = (month, scenario = 'base') => (inRange(month) ? plan.startAmount[scenario] : 0);
  return plan;
}

// ── 은퇴 후 월 소득 타임라인 (5-5) ───────────────────
// 나이마다(그해 생일 달 기준) 연금별 월 수령액. view: 'future'(그때 실제 금액) | 'present'(지금 돈 가치)
// 설정으로 연금마다 수령 계획을 만든다. 출생연도가 없으면 계산할 수 없어 빈 목록, 개시 연령이 없는 연금은 뺀다.
// accountValues: 계좌별 보유 종목 평가금액 (계좌에 연결한 적립형 연금의 적립금)
export function planPensions(pensions, { settings, accountValues = {}, nowMonth }) {
  if (!settings.birthYear) return [];
  return pensions
    .filter((pension) => pension.startAge != null)
    .map((pension) => planPension(pension, {
      birthYear: settings.birthYear,
      birthMonth: settings.birthMonth,
      lifeExpectancy: settings.lifeExpectancy,
      nowMonth,
      inflationRate: settings.inflationRate,
      taxRate: settings.pensionTaxRate,
      linkedBalance: accountValues[pension.linkedAccount] ?? 0,
    }));
}

// 예상 월 연금액 요약 (대시보드): 받을 연금마다 받기 시작할 때의 월 수령액(기준)을 현재가치로 바꿔 더한다.
// first: 가장 먼저 시작하는 연금
export function pensionSummary(plans, { nowMonth, inflationRate }) {
  const paying = plans.filter((plan) => plan.months > 0);
  const monthlyTotal = paying.reduce((sum, plan) => sum + toPresentValue(plan.startAmount.base, plan.startMonth - nowMonth, inflationRate), 0);
  const first = paying.reduce((earliest, plan) => (earliest && earliest.startMonth <= plan.startMonth ? earliest : plan), null);
  return { count: paying.length, monthlyTotal, first };
}

export function incomeTimeline(plans, {
  birthYear, birthMonth = 1, fromAge, toAge, nowMonth, inflationRate, view = 'future', scenario = 'base',
}) {
  const ages = [];
  for (let age = fromAge; age <= toAge; age += 1) ages.push(age);
  return {
    ages,
    series: plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      values: ages.map((age) => {
        const month = monthIndexAtAge(age, birthYear, birthMonth);
        const nominal = plan.monthlyAt(month, scenario);
        return view === 'present' ? toPresentValue(nominal, month - nowMonth, inflationRate) : nominal;
      }),
    })),
  };
}

// ── 소득 공백기 (6-9) ──────────────────────────
// 공백 기간 = 퇴직 시점 ~ 가장 먼저 시작하는 연금의 개시 시점 (음수면 공백 없음)
export function incomeGap(plans, retirementMonth) {
  const starts = plans.filter((plan) => plan.months > 0).map((plan) => plan.startMonth);
  if (starts.length === 0) return { firstStartMonth: null, gapMonths: null };
  const firstStartMonth = Math.min(...starts);
  return { firstStartMonth, gapMonths: Math.max(0, firstStartMonth - retirementMonth) };
}

// 감당 가능 연수 = 퇴직 시점의 기타 금융자산 / (월 목표 생활비 × 12)
export function coverageYears(amount, monthlyLivingCost) {
  return monthlyLivingCost > 0 ? amount / (monthlyLivingCost * 12) : null;
}

// ── 퇴직(목표) 시점 종합 (5-5) ──────────────────────
// stockValue: 계좌에 연결한 연금의 종목을 뺀 주식 평가금액 (그 종목은 연금으로 계산되므로)
// 돌려주는 값은 모두 그때의 실제 금액(미래 금액)
export function retirementProjection({
  stockValue, monthlyInvestment, stockReturns, otherAssets, plans, retirementMonth, nowMonth,
}) {
  const months = Math.max(0, retirementMonth - nowMonth);
  const stocks = {};
  const deposits = { low: 0, base: 0, high: 0, byType: {} };
  for (const scenario of SCENARIOS) {
    stocks[scenario] = projectStocks({ value: stockValue, monthlyInvestment, annualReturn: stockReturns[scenario], months });
  }
  for (const asset of otherAssets) {
    const projection = projectOtherAsset(asset, { nowMonth, endMonth: retirementMonth });
    for (const scenario of SCENARIOS) deposits[scenario] += valueAt(projection[scenario], retirementMonth).balance;
    const base = valueAt(projection.base, retirementMonth).balance;
    deposits.byType[asset.type] = (deposits.byType[asset.type] ?? 0) + base;
  }
  const pensionTotal = plans.reduce((sum, plan) => sum + (plan.months > 0 ? plan.startAmount.base : 0), 0);
  return { months, stocks, deposits, pensionTotal };
}
