import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floorToStep, isTargetComplete, rebalance, targetSum } from '../js/calc/rebalance.js';
import { valuePortfolio } from '../js/calc/valuation.js';

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ''} ${actual} ≠ ${expected}`);

function holding(id, { price = 10_000, quantity = 100, ...overrides } = {}) {
  return {
    id, name: id, ticker: `KRX:${id}`, type: 'stock', currency: 'KRW', quantity, avgPrice: price, manualPrice: price,
    account: '일반', assetClass: '성장주', countryMix: { 한국: 100 }, sectorMix: { 기술: 100 }, dividendPerShare: null, memo: '',
    ...overrides,
  };
}
const tickerTargets = (map) => ({ mode: 'ticker', assetClass: {}, ticker: Object.fromEntries(Object.entries(map).map(([id, pct]) => [`KRX:${id}`, pct])) });
const classTargets = (map) => ({ mode: 'assetClass', assetClass: map, ticker: {} });

function run(holdings, options, fxRate = 1000) {
  return rebalance({ rows: valuePortfolio(holdings, { fxRate }).rows, fxRate, ...options });
}
const lineOf = (result, ticker, group = 0) => result.groups[group].lines.find((line) => line.ticker === `KRX:${ticker}` || line.ticker === ticker);
const trade = (line) => [line.action, line.tradeQuantity];

test('전체 리밸런싱: 목표 금액 = 총액 × 목표 비중, 차이만큼 사고판다', () => {
  const result = run([holding('A'), holding('B')], { targets: tickerTargets({ A: 70, B: 30 }) });
  assert.equal(result.ok, true);
  const a = lineOf(result, 'A');
  near(a.targetValue, 1_400_000);
  near(a.diff, 400_000);
  assert.deepEqual(trade(a), ['buy', 40]);
  assert.deepEqual(trade(lineOf(result, 'B')), ['sell', 40]);
  near(result.groups[0].leftover, 0);
  near(lineOf(result, 'A').afterWeight, 0.7);
});

test('전체 리밸런싱 + 추가 투자금: (총액 + 추가 투자금) × 목표 비중', () => {
  const result = run([holding('A'), holding('B')], { targets: tickerTargets({ A: 70, B: 30 }), additional: 1_000_000 });
  assert.deepEqual(trade(lineOf(result, 'A')), ['buy', 110]);
  assert.deepEqual(trade(lineOf(result, 'B')), ['sell', 10]);
  near(result.groups[0].leftover, 0);
});

test('매수만: 목표보다 모자란 금액에 비례해 추가 투자금을 나눈다 (매도 없음)', () => {
  const onlyA = run([holding('A'), holding('B')], { targets: tickerTargets({ A: 70, B: 30 }), method: 'buyOnly', additional: 1_000_000 });
  assert.deepEqual(trade(lineOf(onlyA, 'A')), ['buy', 100]);
  assert.deepEqual(trade(lineOf(onlyA, 'B')), ['hold', 0]);

  const split = run([holding('A'), holding('B')], { targets: tickerTargets({ A: 60, B: 40 }), method: 'buyOnly', additional: 1_000_000 });
  assert.deepEqual(trade(lineOf(split, 'A')), ['buy', 80]);
  assert.deepEqual(trade(lineOf(split, 'B')), ['buy', 20]);
  assert.ok(split.groups[0].lines.every((line) => line.action !== 'sell'));
});

test('매수만: 이미 목표에 맞으면 목표 비중대로 나눠 산다', () => {
  const result = run([holding('A'), holding('B')], { targets: tickerTargets({ A: 50, B: 50 }), method: 'buyOnly', additional: 1_000_000 });
  assert.deepEqual(trade(lineOf(result, 'A')), ['buy', 50]);
  assert.deepEqual(trade(lineOf(result, 'B')), ['buy', 50]);
});

test('추가 투자금 0으로 매수만 모드는 계산하지 않는다', () => {
  const result = run([holding('A')], { targets: tickerTargets({ A: 100 }), method: 'buyOnly', additional: 0 });
  assert.deepEqual(result, { ok: false, error: 'no-additional' });
});

test('이미 목표에 맞는 상태: 사고팔 것이 없고 허용 오차 안이라고 알려준다', () => {
  const result = run([holding('A'), holding('B')], { targets: tickerTargets({ A: 50, B: 50 }) });
  assert.ok(result.groups[0].lines.every((line) => line.action === 'hold'));
  assert.equal(result.groups[0].withinBand, true);
  near(result.groups[0].maxDrift, 0);
});

test('허용 오차: 목표와 차이가 밴드(±5%p) 이내인지', () => {
  const inside = run([holding('A', { quantity: 52 }), holding('B', { quantity: 48 })], { targets: tickerTargets({ A: 50, B: 50 }), band: 5 });
  assert.equal(inside.groups[0].withinBand, true);
  near(inside.groups[0].maxDrift, 0.02);
  const outside = run([holding('A', { quantity: 58 }), holding('B', { quantity: 42 })], { targets: tickerTargets({ A: 50, B: 50 }), band: 5 });
  assert.equal(outside.groups[0].withinBand, false);
});

test('목표 비중 합계가 100이 아니면 계산하지 않는다', () => {
  const holdings = [holding('A'), holding('B')];
  const targets = tickerTargets({ A: 60, B: 30 });
  assert.equal(targetSum(targets, holdings), 90);
  assert.equal(isTargetComplete(targets, holdings), false);
  assert.deepEqual(run(holdings, { targets }), { ok: false, error: 'target-sum', sum: 90 });
  assert.equal(isTargetComplete(classTargets({ 성장주: 70, 채권: 30 }), holdings), true);
});

test('보유 종목이 없으면 계산하지 않는다', () => {
  assert.equal(run([], { targets: classTargets({ 성장주: 100 }) }).error, 'no-holdings');
});

test('자산군 모드: 자산군 목표를 그 안의 종목들에 지금 비율대로 나눈다', () => {
  const result = run([holding('A'), holding('B'), holding('C', { assetClass: '채권' })], { targets: classTargets({ 성장주: 50, 채권: 50 }) });
  near(lineOf(result, 'A').targetValue, 750_000);
  assert.deepEqual(trade(lineOf(result, 'A')), ['sell', 25]);
  assert.deepEqual(trade(lineOf(result, 'B')), ['sell', 25]);
  assert.deepEqual(trade(lineOf(result, 'C')), ['buy', 50]);
  const categories = Object.fromEntries(result.groups[0].categories.map((item) => [item.name, [item.current, item.target]]));
  near(categories.성장주[0], 2 / 3);
  near(categories.성장주[1], 0.5);
});

test('자산군 모드: 목표가 있는데 살 종목이 없는 자산군은 알려주고, 나머지 비율로 맞춘다', () => {
  const result = run([holding('A'), holding('B')], { targets: classTargets({ 성장주: 80, 채권: 20 }) });
  assert.deepEqual(result.groups[0].missing, [{ name: '채권', target: 0.2 }]);
  assert.ok(result.groups[0].lines.every((line) => line.action === 'hold'));
});

test('자산군 모드: 수량 0인 종목(새로 살 종목)만 있는 자산군은 똑같이 나눠 산다', () => {
  const result = run([
    holding('A'),
    holding('B1', { quantity: 0, assetClass: '채권' }),
    holding('B2', { quantity: 0, assetClass: '채권' }),
  ], { targets: classTargets({ 성장주: 50, 채권: 50 }) });
  assert.deepEqual(trade(lineOf(result, 'A')), ['sell', 50]);
  assert.deepEqual(trade(lineOf(result, 'B1')), ['buy', 25]);
  assert.deepEqual(trade(lineOf(result, 'B2')), ['buy', 25]);
});

test('목표 0%인 종목은 모두 판다', () => {
  const result = run([holding('A'), holding('B')], { targets: tickerTargets({ A: 100, B: 0 }) });
  assert.deepEqual(trade(lineOf(result, 'B')), ['sell', 100]);
  assert.deepEqual(trade(lineOf(result, 'A')), ['buy', 100]);
});

test('수량은 내림하고, 남는 돈과 그 돈으로 더 살 수 있는 종목을 알려준다', () => {
  const result = run([holding('A', { price: 30_000, quantity: 0 }), holding('B', { price: 7_000, quantity: 0 })], {
    targets: tickerTargets({ A: 50, B: 50 }), method: 'buyOnly', additional: 100_000,
  });
  assert.deepEqual(trade(lineOf(result, 'A')), ['buy', 1]);
  assert.deepEqual(trade(lineOf(result, 'B')), ['buy', 7]);
  near(result.groups[0].leftover, 21_000);
  assert.deepEqual(result.groups[0].suggestions.map((item) => [item.ticker, item.cost]), [['KRX:B', 7_000]]);
  assert.equal(result.groups[0].withinBand, false);
});

test('미국 주식: 소수점 매매를 끄면 정수로, 켜면 소수점으로', () => {
  const holdings = [
    holding('US', { price: 100, quantity: 1, currency: 'USD', ticker: 'NASDAQ:US' }),
    holding('B', { quantity: 10 }),
  ];
  const targets = { mode: 'ticker', assetClass: {}, ticker: { 'NASDAQ:US': 25, 'KRX:B': 75 } };
  // 0.5주를 팔아야 하지만 정수만 되면 못 판다 → 판 돈이 없으니 B도 못 산다 (돈이 모자라지 않게 줄임)
  const whole = run(holdings, { targets });
  assert.deepEqual(trade(lineOf(whole, 'NASDAQ:US')), ['hold', 0]);
  assert.deepEqual(trade(lineOf(whole, 'B')), ['hold', 0]);
  near(whole.groups[0].leftover, 0);
  const fractional = run(holdings, { targets, allowFractionalUS: true });
  assert.deepEqual(trade(lineOf(fractional, 'NASDAQ:US')), ['sell', 0.5]);
  assert.deepEqual(trade(lineOf(fractional, 'B')), ['buy', 5]);
});

test('판 돈이 내림으로 줄어 살 돈이 모자라면 매수를 줄인다', () => {
  const result = run([holding('A', { price: 1_000_000, quantity: 3 }), holding('B', { quantity: 0 })], { targets: tickerTargets({ A: 50, B: 50 }) });
  assert.deepEqual(trade(lineOf(result, 'A')), ['sell', 1]); // 1.5주 → 1주
  assert.deepEqual(trade(lineOf(result, 'B')), ['buy', 100]); // 150주 계획 → 판 돈 100만원만큼
  near(result.groups[0].leftover, 0);
});

test('환율이 없는 달러 종목은 계산에서 빼고 알려준다', () => {
  const result = run([holding('A'), holding('US', { currency: 'USD', ticker: 'NASDAQ:US', price: 100 })], {
    targets: { mode: 'ticker', assetClass: {}, ticker: { 'KRX:A': 50, 'NASDAQ:US': 50 } },
  }, null);
  assert.deepEqual(result.excluded.map((item) => item.ticker), ['NASDAQ:US']);
  assert.equal(result.groups[0].lines.length, 1);
  assert.deepEqual(trade(lineOf(result, 'A')), ['hold', 0]);
});

test('전체 계산: 같은 종목을 여러 계좌에 나눠 가지면 하나로 묶는다', () => {
  const result = run([holding('A', { quantity: 50 }), holding('A2', { ticker: 'KRX:A', quantity: 50, account: 'ISA' }), holding('B')], {
    targets: tickerTargets({ A: 50, B: 50 }),
  });
  const a = lineOf(result, 'A');
  assert.equal(a.quantity, 100);
  assert.deepEqual(a.accounts, ['일반', 'ISA']);
  assert.equal(result.groups[0].lines.length, 2);
});

test('계좌별: 같은 목표를 계좌마다 따로, 계좌에 없는 자산군은 빼고 맞춘다', () => {
  const holdings = [
    holding('A', { account: '일반' }),
    holding('B', { account: 'ISA', quantity: 50 }),
    holding('C', { account: 'ISA', quantity: 50, assetClass: '채권' }),
  ];
  const result = run(holdings, { targets: classTargets({ 성장주: 50, 채권: 50 }), byAccount: true });
  assert.deepEqual(result.groups.map((group) => group.account), ['일반', 'ISA']);
  const [general, isa] = result.groups;
  assert.deepEqual(general.missing, [{ name: '채권', target: 0.5 }]);
  assert.ok(general.lines.every((line) => line.action === 'hold'));
  assert.equal(isa.withinBand, true);

  const withMoney = run(holdings, {
    targets: classTargets({ 성장주: 50, 채권: 50 }), byAccount: true, method: 'buyOnly', additionalByAccount: { ISA: 100_000 },
  });
  assert.deepEqual(trade(lineOf(withMoney, 'B', 1)), ['buy', 5]);
  assert.deepEqual(trade(lineOf(withMoney, 'C', 1)), ['buy', 5]);
  assert.ok(withMoney.groups[0].lines.every((line) => line.action === 'hold'));
});

test('계좌별·종목 모드: 계좌 안의 종목끼리 목표 비율을 다시 나눈다', () => {
  const holdings = [holding('A', { account: '일반' }), holding('B', { account: '일반' }), holding('C', { account: 'ISA' })];
  const result = run(holdings, { targets: tickerTargets({ A: 30, B: 10, C: 60 }), byAccount: true });
  near(lineOf(result, 'A', 0).targetWeight, 0.75);
  assert.deepEqual(trade(lineOf(result, 'A', 0)), ['buy', 50]);
  assert.deepEqual(trade(lineOf(result, 'B', 0)), ['sell', 50]);
  assert.equal(result.groups[1].lines[0].action, 'hold');
});

test('계좌별·종목 모드: 계좌의 어느 종목에도 목표가 없으면 그 계좌는 그대로 둔다', () => {
  const holdings = [holding('A', { account: '일반' }), holding('C', { account: 'ISA' })];
  const result = run(holdings, { targets: tickerTargets({ A: 100, C: 0 }), byAccount: true });
  assert.equal(result.groups[1].noTargets, true);
  assert.deepEqual(result.groups[1].lines, []);
});

test('floorToStep', () => {
  assert.equal(floorToStep(2.9999999999, 1), 3);
  assert.equal(floorToStep(2.5, 1), 2);
  assert.equal(floorToStep(0.123456, 0.0001), 0.1234);
  assert.equal(floorToStep(-1, 1), 0);
});
