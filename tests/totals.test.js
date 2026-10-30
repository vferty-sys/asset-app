import { test } from 'node:test';
import assert from 'node:assert/strict';
import { otherFinancialAssets } from '../js/calc/totals.js';

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
