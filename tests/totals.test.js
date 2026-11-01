import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetSummary, otherFinancialAssets, valueByAccount } from '../js/calc/totals.js';

const row = (account, assetClass, valueKRW) => ({ holding: { account, assetClass }, valueKRW });

test('기타 금융자산 = 공제회·예적금 + 계좌에 연결하지 않은 적립형 연금', () => {
  const result = otherFinancialAssets({
    otherAssets: [{ balance: 10_000_000 }, { balance: 2_500_000 }, { balance: null }, { balance: -1 }],
    pensions: [
      { kind: 'accumulating', balance: 3_000_000, linkedAccount: null },
      { kind: 'accumulating', balance: 7_000_000, linkedAccount: '연금저축' },
      { kind: 'fixed', expectedMonthlyAmount: 2_000_000 },
    ],
  });
  assert.deepEqual(result, { deposits: 12_500_000, pensionBalance: 3_000_000, total: 15_500_000 });
});

test('계좌에 연결한 적립형 연금은 보유 종목으로 이미 계산되므로 더하지 않는다 (이중 합산 방지)', () => {
  const result = otherFinancialAssets({ pensions: [{ kind: 'accumulating', balance: 7_000_000, linkedAccount: 'IRP' }] });
  assert.equal(result.total, 0);
});

test('기타 자산·연금이 없으면 0', () => {
  assert.deepEqual(otherFinancialAssets(), { deposits: 0, pensionBalance: 0, total: 0 });
  assert.deepEqual(otherFinancialAssets({ otherAssets: [], pensions: [] }), { deposits: 0, pensionBalance: 0, total: 0 });
});

test('계좌별 평가금액: 평가할 수 없거나 0원인 종목은 빼고 계좌마다 더한다', () => {
  const rows = [row('일반', '성장주', 1_000), row('IRP', '채권', 500), row('일반', '배당주', 250), row('ISA', '성장주', null), row('ISA', '성장주', 0)];
  assert.deepEqual(valueByAccount(rows), { 일반: 1_250, IRP: 500 });
  assert.deepEqual(valueByAccount(), {});
});

test('지금 자산 요약: 투자자산 + 기타 금융자산 = 총자산, 자산군별 금액 (연결한 연금은 다시 더하지 않음)', () => {
  const summary = assetSummary({
    rows: [row('일반', '성장주', 6_000_000), row('IRP', '채권', 2_000_000), row('일반', '성장주', 1_000_000), row('일반', '성장주', null)],
    otherAssets: [{ balance: 3_000_000 }],
    pensions: [
      { kind: 'accumulating', balance: 1_500_000, linkedAccount: null },
      { kind: 'accumulating', balance: 9_999_999, linkedAccount: 'IRP' },
    ],
  });
  assert.deepEqual(summary, {
    invested: 9_000_000,
    cash: 0,
    others: 4_500_000,
    total: 13_500_000,
    deposits: 3_000_000,
    pensionBalance: 1_500_000,
    byAssetClass: { 성장주: 7_000_000, 채권: 2_000_000, '예적금·공제회': 3_000_000, '연금 적립금': 1_500_000 },
  });
  assert.deepEqual(assetSummary(), { invested: 0, cash: 0, others: 0, total: 0, deposits: 0, pensionBalance: 0, byAssetClass: {} });
});

test('예수금: 투자자산과 현금성, 계좌별 금액(연금 계좌 연결용)에 더한다', () => {
  const rows = [row('일반', '성장주', 6_000_000), row('IRP', '채권', 2_000_000)];
  const summary = assetSummary({ rows, cashByAccount: { 일반: 500_000, IRP: 300_000 } });
  assert.equal(summary.invested, 8_800_000);
  assert.equal(summary.cash, 800_000);
  assert.equal(summary.total, 8_800_000);
  assert.deepEqual(summary.byAssetClass, { 성장주: 6_000_000, 채권: 2_000_000, 현금성: 800_000 });
  assert.deepEqual(valueByAccount(rows, { IRP: 300_000, 연금저축: 100_000 }), { 일반: 6_000_000, IRP: 2_300_000, 연금저축: 100_000 });
  assert.deepEqual(valueByAccount(rows), { 일반: 6_000_000, IRP: 2_000_000 });
});
