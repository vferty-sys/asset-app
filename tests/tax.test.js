import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateCosts, overseasCapitalGainsTax } from '../js/calc/tax.js';
import { DEFAULT_SETTINGS } from '../js/constants.js';

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ''} ${actual} ≠ ${expected}`);

const line = (overrides) => ({
  action: 'buy', amount: 0, currency: 'KRW', type: 'stock', price: 0, avgPrice: 0, tradeQuantity: 0, fx: 1, ...overrides,
});

test('해외주식 양도소득세: (한 해 차익 − 250만원) × 22%, 음수면 0', () => {
  near(overseasCapitalGainsTax(10_000_000), 1_650_000);
  assert.equal(overseasCapitalGainsTax(2_500_000), 0);
  assert.equal(overseasCapitalGainsTax(-1_000_000), 0);
});

test('수수료 = 매매 금액 × 수수료율 (국내·해외 따로)', () => {
  const costs = estimateCosts([
    line({ action: 'buy', amount: 1_000_000 }),
    line({ action: 'sell', amount: -2_000_000, type: 'etf' }),
    line({ action: 'buy', amount: 4_000_000, currency: 'USD', fx: 1000 }),
    line({ action: 'hold', amount: 0 }),
  ], { ...DEFAULT_SETTINGS, feeRateDomestic: 0.015, feeRateOverseas: 0.25 });
  near(costs.feeDomestic, 3_000_000 * 0.00015);
  near(costs.feeOverseas, 4_000_000 * 0.0025);
  near(costs.fee, 450 + 10_000);
});

test('국내 매도 거래세: 주식에만 설정 세율, 국내 상장 ETF는 없음', () => {
  const costs = estimateCosts([
    line({ action: 'sell', amount: -1_000_000, type: 'stock' }),
    line({ action: 'sell', amount: -5_000_000, type: 'etf' }),
    line({ action: 'buy', amount: 9_000_000, type: 'stock' }),
  ], { ...DEFAULT_SETTINGS, domesticSellTaxRate: 0.2 });
  near(costs.domesticTax, 2_000);
});

test('해외주식 매도 차익: 공제 250만원 안이면 세금 없음, 올해 실현 차익과 합치면 늘어난 만큼만', () => {
  // $150에 10주 매도, 평단가 $100, 환율 1,000원 → 차익 50만원
  const sell = line({ action: 'sell', amount: -1_500_000, currency: 'USD', price: 150, avgPrice: 100, tradeQuantity: 10, fx: 1000 });
  const alone = estimateCosts([sell], DEFAULT_SETTINGS);
  near(alone.overseasGain, 500_000);
  assert.equal(alone.overseasTax, 0);

  const withRealized = estimateCosts([sell], DEFAULT_SETTINGS, { realizedOverseasGain: 3_000_000 });
  near(withRealized.overseasYearTax, 220_000); // (350만 − 250만) × 22%
  near(withRealized.overseasTax, 110_000); // 이미 실현한 300만원 몫(11만원)을 뺀 이번 매도분
});

test('해외주식 손실 매도는 같은 해 차익과 합쳐져 세금을 줄인다', () => {
  const loss = line({ action: 'sell', amount: -500_000, currency: 'USD', price: 50, avgPrice: 150, tradeQuantity: 10, fx: 1000 });
  const costs = estimateCosts([loss], DEFAULT_SETTINGS, { realizedOverseasGain: 3_000_000 });
  near(costs.overseasGain, -1_000_000);
  assert.equal(costs.overseasYearTax, 0);
  near(costs.overseasTax, -110_000);
  near(costs.total, costs.fee + costs.domesticTax); // 줄어드는 세금은 비용 합계에서 빼지 않는다
});
