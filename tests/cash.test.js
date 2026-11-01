// 예수금: 계좌별 원화·달러 정리와 원화 환산
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cashInKRW, normalizeCash } from '../js/cash.js';
import { analyzeDiversification } from '../js/calc/diversification.js';
import { createDefaultData, normalizeData, parseBackup } from '../js/storage.js';

test('예수금 정리: 앱의 계좌·통화만, 0·음수·숫자가 아닌 값은 버린다', () => {
  assert.deepEqual(normalizeCash({
    일반: { KRW: 500000, USD: 120.5 }, IRP: { KRW: 0, USD: -3 }, 연금저축: { KRW: '1000' }, 해외계좌: { KRW: 1 }, ISA: 5,
  }), { 일반: { KRW: 500000, USD: 120.5 } });
  assert.deepEqual(normalizeCash(null), {});
});

test('원화 환산: 달러는 환율로, 환율이 없으면 빼고 알려 준다', () => {
  const cash = { 일반: { KRW: 500000, USD: 100 }, IRP: { KRW: 30000 } };
  assert.deepEqual(cashInKRW(cash, 1400), { byAccount: { 일반: 640000, IRP: 30000 }, total: 670000, missingUsd: 0 });
  assert.deepEqual(cashInKRW(cash, null), { byAccount: { 일반: 500000, IRP: 30000 }, total: 530000, missingUsd: 100 });
  assert.deepEqual(cashInKRW({ ISA: { USD: 50 } }, 0), { byAccount: {}, total: 0, missingUsd: 50 });
  assert.deepEqual(cashInKRW(undefined, 1400), { byAccount: {}, total: 0, missingUsd: 0 });
});

test('분산 분석: 예수금은 자산군(현금성)·계좌에만 더하고 국가·섹터에는 넣지 않는다', () => {
  const rows = [{ valueKRW: 900000, holding: { assetClass: '성장주', account: '일반', countryMix: { 미국: 100 }, sectorMix: { 기술: 100 } } }];
  const result = analyzeDiversification(rows, { cashByAccount: { 일반: 100000, IRP: 0 } });
  assert.equal(result.cashTotal, 100000);
  assert.equal(result.total, 1000000);
  assert.deepEqual(result.assetClass.map((item) => [item.name, item.weight]), [['성장주', 0.9], ['현금성', 0.1]]);
  assert.deepEqual(result.account.map((item) => [item.name, item.value]), [['일반', 1000000]]);
  assert.deepEqual(result.country.map((item) => [item.name, item.weight]), [['미국', 1]]);
});

test('저장 데이터·백업에 예수금이 들어가고, 없던 예전 데이터는 빈 값', () => {
  assert.deepEqual(createDefaultData().cash, {});
  assert.deepEqual(normalizeData({ holdings: [] }).cash, {});
  const restored = parseBackup(JSON.stringify({ app: 'asset-app', data: { schemaVersion: 1, cash: { ISA: { KRW: 250000 } } } }));
  assert.deepEqual(restored.cash, { ISA: { KRW: 250000 } });
});
