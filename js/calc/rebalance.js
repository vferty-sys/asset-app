// 리밸런싱 계산 (요청서 6-4)
//  목표 금액 = (리밸런싱 대상 총액 + 추가 투자금) × 목표 비중
//  차이 금액 = 목표 금액 − 현재 금액
//  수량 = 차이 금액 / (현재가 × 환율) — 한국 주식은 정수로 내림, 미국 주식은 설정에 따라 소수점 허용
//  매수만 모드: 목표보다 모자란 금액에 비례해 추가 투자금을 나눈다
//  자산군 모드: 자산군별 목표를 그 자산군 안의 종목들에 지금 비율대로 나눈다
// 기타 금융자산과 연금은 사고팔 수 없으므로 넣지 않는다 (보유 종목만 계산).
// 계좌별 계산: 같은 목표를 계좌마다 따로 맞춘다. 계좌에 없는 자산군·종목은 빼고 나머지 비율로 맞춘다.

import { ACCOUNTS, ASSET_CLASSES, FRACTIONAL_STEP } from '../constants.js';

const EPSILON = 1e-9;

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function positivePercent(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

// 목표 비중을 입력받는 항목: 자산군 모드는 자산군 전체, 종목 모드는 보유 중인 티커 전체
export function targetKeys(mode, holdings) {
  if (mode === 'assetClass') return [...ASSET_CLASSES];
  return [...new Set(holdings.map((holding) => holding.ticker))];
}

// 입력한 목표 비중 합계(%)
export function targetSum(targets, holdings) {
  const values = targets.mode === 'assetClass' ? targets.assetClass : targets.ticker;
  return sum(targetKeys(targets.mode, holdings).map((key) => positivePercent(values[key])));
}

export function isTargetComplete(targets, holdings) {
  return Math.abs(targetSum(targets, holdings) - 100) < 0.01;
}

// 내림. 소수 오차(0.29999…) 때문에 한 단위가 빠지지 않게 아주 작은 값을 더한다.
export function floorToStep(value, step) {
  if (!(value > 0)) return 0;
  return Number((Math.floor(value / step + EPSILON) * step).toFixed(6));
}

// 매매 단위로 묶는다. 전체 계산이면 같은 티커를 하나로, 계좌별이면 계좌·티커마다.
function buildLines(rows, { byAccount, fxRate }) {
  const lines = new Map();
  const excluded = [];
  for (const row of rows) {
    const { holding } = row;
    if (row.valueKRW == null) {
      excluded.push({ name: holding.name, ticker: holding.ticker, reason: row.missingFx ? '달러 환율이 없어 계산에서 뺐어요.' : '현재가가 없어 계산에서 뺐어요.' });
      continue;
    }
    const fx = holding.currency === 'USD' ? fxRate : 1;
    const unitKRW = row.price * fx;
    if (!(unitKRW > 0)) {
      excluded.push({ name: holding.name, ticker: holding.ticker, reason: '현재가가 0이라 사고팔 수 없어요.' });
      continue;
    }
    const account = byAccount ? holding.account : null;
    const key = `${account ?? '*'}|${holding.ticker}`;
    const line = lines.get(key) ?? {
      key,
      account,
      accounts: [],
      ticker: holding.ticker,
      name: holding.name,
      type: holding.type,
      currency: holding.currency,
      assetClass: holding.assetClass,
      price: row.price,
      priceSource: row.priceSource,
      fx,
      unitKRW,
      quantity: 0,
      value: 0,
      costLocal: 0,
    };
    line.quantity += holding.quantity;
    line.value += row.valueKRW;
    line.costLocal += holding.quantity * holding.avgPrice;
    if (holding.type === 'etf') line.type = 'etf';
    if (!line.accounts.includes(holding.account)) line.accounts.push(holding.account);
    lines.set(key, line);
  }
  return {
    lines: [...lines.values()].map((line) => ({ ...line, avgPrice: line.quantity > 0 ? line.costLocal / line.quantity : 0 })),
    excluded,
  };
}

// 종목별 목표 비중(0~1). 이 묶음에 있는 항목끼리 합이 1이 되게 다시 나눈다.
function lineTargetWeights(lines, targets) {
  if (targets.mode === 'ticker') {
    const raw = lines.map((line) => positivePercent(targets.ticker[line.ticker]));
    const total = sum(raw);
    return { weights: total > 0 ? raw.map((value) => value / total) : null, missing: [] };
  }

  const classValue = new Map();
  const classCount = new Map();
  for (const line of lines) {
    classValue.set(line.assetClass, (classValue.get(line.assetClass) ?? 0) + line.value);
    classCount.set(line.assetClass, (classCount.get(line.assetClass) ?? 0) + 1);
  }
  const classTarget = (name) => positivePercent(targets.assetClass[name]);
  const presentTotal = sum([...classValue.keys()].map(classTarget));
  // 목표가 있는데 이 묶음에 종목이 없는 자산군 (살 종목이 없음)
  const missing = ASSET_CLASSES
    .filter((name) => classTarget(name) > 0 && !classValue.has(name))
    .map((name) => ({ name, target: classTarget(name) / 100 }));
  if (presentTotal <= 0) return { weights: null, missing };
  const weights = lines.map((line) => {
    const share = classTarget(line.assetClass) / presentTotal;
    const inClass = classValue.get(line.assetClass);
    // 자산군 안의 종목 간 배분은 지금 비율 유지 (모두 0원이면 똑같이)
    const within = inClass > 0 ? line.value / inClass : 1 / classCount.get(line.assetClass);
    return share * within;
  });
  return { weights, missing };
}

// 목표 대비 비중 비교 항목 (허용 오차 판단과 막대 비교 차트용)
function categoriesOf(plan, targets, current) {
  if (targets.mode === 'ticker') {
    return plan.map((line) => ({ name: line.name, current: line.currentWeight, target: line.targetWeight }));
  }
  const map = new Map();
  for (const line of plan) {
    const item = map.get(line.assetClass) ?? { name: line.assetClass, value: 0, target: 0 };
    item.value += line.value;
    item.target += line.targetWeight;
    map.set(line.assetClass, item);
  }
  return [...map.values()].map((item) => ({ name: item.name, current: current > 0 ? item.value / current : 0, target: item.target }));
}

function planGroup(lines, targets, { method, additional, allowFractionalUS, band }) {
  const current = sum(lines.map((line) => line.value));
  const total = current + additional;
  const { weights, missing } = lineTargetWeights(lines, targets);
  if (!weights) {
    return { current, additional, total, lines: [], categories: [], missing, noTargets: true, withinBand: false, maxDrift: 0, leftover: additional, suggestions: [] };
  }

  const plan = lines.map((line, index) => {
    const targetWeight = weights[index];
    const targetValue = total * targetWeight;
    return {
      ...line,
      currentWeight: current > 0 ? line.value / current : 0,
      targetWeight,
      targetValue,
      diff: targetValue - line.value,
      step: line.currency === 'USD' && allowFractionalUS ? FRACTIONAL_STEP : 1,
    };
  });

  // 계획 금액 (+ 매수, − 매도)
  if (method === 'buyOnly') {
    const shortfalls = plan.map((line) => Math.max(0, line.diff));
    const shortfallTotal = sum(shortfalls);
    plan.forEach((line, index) => { line.planned = shortfallTotal > 0 ? (additional * shortfalls[index]) / shortfallTotal : 0; });
  } else {
    plan.forEach((line) => { line.planned = line.diff; });
  }

  // 수량으로 바꾸기 (내림)
  for (const line of plan) {
    if (line.planned < -EPSILON) {
      const quantity = line.targetWeight === 0
        ? line.quantity // 목표 0%면 모두 판다
        : Math.min(line.quantity, floorToStep(-line.planned / line.unitKRW, line.step));
      line.tradeQuantity = quantity;
      line.action = quantity > 0 ? 'sell' : 'hold';
    } else if (line.planned > EPSILON) {
      line.tradeQuantity = floorToStep(line.planned / line.unitKRW, line.step);
      line.action = line.tradeQuantity > 0 ? 'buy' : 'hold';
    } else {
      line.tradeQuantity = 0;
      line.action = 'hold';
    }
    line.amount = (line.action === 'sell' ? -1 : 1) * line.tradeQuantity * line.unitKRW;
  }

  // 판 돈이 내림으로 줄어 살 돈이 모자라면, 목표를 가장 많이 넘는 매수부터 한 단위씩 줄인다.
  const leftoverOf = () => additional - sum(plan.map((line) => line.amount));
  while (leftoverOf() < -EPSILON) {
    const buys = plan.filter((line) => line.action === 'buy' && line.tradeQuantity > 0);
    if (buys.length === 0) break;
    const over = (line) => line.value + line.amount - line.targetValue;
    const pick = buys.reduce((best, line) => (over(line) > over(best) ? line : best));
    pick.tradeQuantity = Number(Math.max(0, pick.tradeQuantity - pick.step).toFixed(6));
    pick.amount = pick.tradeQuantity * pick.unitKRW;
    if (pick.tradeQuantity === 0) pick.action = 'hold';
  }
  const leftover = Math.max(0, leftoverOf());

  const investedAfter = sum(plan.map((line) => line.value + line.amount));
  for (const line of plan) {
    line.afterValue = line.value + line.amount;
    line.afterWeight = investedAfter > 0 ? line.afterValue / investedAfter : 0;
  }

  // 남은 돈으로 1단위 더 살 수 있는 종목 (목표보다 많이 모자란 순서)
  const suggestions = plan
    .filter((line) => line.action !== 'sell' && line.targetWeight > 0 && line.unitKRW * line.step <= leftover + EPSILON)
    .map((line) => ({ name: line.name, ticker: line.ticker, account: line.account, cost: line.unitKRW * line.step, step: line.step, gap: line.afterValue - line.targetValue }))
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 3);

  const categories = categoriesOf(plan, targets, current);
  const maxDrift = Math.max(0, ...categories.map((item) => Math.abs(item.current - item.target)));
  return {
    current,
    additional,
    total,
    lines: plan,
    categories,
    missing,
    noTargets: false,
    withinBand: current > 0 && maxDrift <= band / 100 + EPSILON,
    maxDrift,
    leftover,
    suggestions,
  };
}

// rows: valuePortfolio(...).rows
// 돌려주는 값: { ok: true, groups, excluded } | { ok: false, error: 'target-sum' | 'no-holdings' | 'no-additional', ... }
export function rebalance({
  rows,
  fxRate = null,
  targets,
  method = 'full',
  additional = 0,
  additionalByAccount = {},
  byAccount = false,
  allowFractionalUS = false,
  band = 5,
}) {
  const holdings = rows.map((row) => row.holding);
  if (!isTargetComplete(targets, holdings)) {
    return { ok: false, error: 'target-sum', sum: targetSum(targets, holdings) };
  }
  const { lines, excluded } = buildLines(rows, { byAccount, fxRate });
  if (lines.length === 0) return { ok: false, error: 'no-holdings', excluded };

  const extraFor = (account) => {
    const value = byAccount ? additionalByAccount[account] : additional;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  };
  const accounts = byAccount
    ? [...ACCOUNTS, ...new Set(lines.map((line) => line.account))].filter((account, index, list) => list.indexOf(account) === index && lines.some((line) => line.account === account))
    : [null];
  if (method === 'buyOnly' && sum(accounts.map(extraFor)) <= 0) return { ok: false, error: 'no-additional' };

  const groups = accounts.map((account) => ({
    account,
    ...planGroup(lines.filter((line) => line.account === account), targets, {
      method, additional: extraFor(account), allowFractionalUS, band,
    }),
  }));
  return { ok: true, method, byAccount, groups, excluded };
}
