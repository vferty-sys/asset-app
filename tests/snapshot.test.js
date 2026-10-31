// 월별 기록(스냅샷): 정리, 만들기, 같은 달 바꾸기, 기록 제안, 지난 기록과의 변화
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSnapshot, latestChange, normalizeSnapshot, normalizeSnapshots, shouldSuggestSnapshot, upsertSnapshot,
} from '../js/snapshot.js';

const snap = (month, invested, others = 0) => ({ month, date: `${month}-15`, invested, others, byAssetClass: {} });

test('기록 정리: 총자산은 투자자산 + 기타 금융자산으로 다시 계산, 원 단위로 반올림', () => {
  const snapshot = normalizeSnapshot({
    month: '2026-10', date: '2026-10-31', total: 1, invested: 1_000_000.4, others: 500_000, byAssetClass: { 성장주: 1_000_000.4, ' 예적금·공제회 ': 500_000, 빈값: 0, 이상: 'x' },
  });
  assert.deepEqual(snapshot, {
    month: '2026-10', date: '2026-10-31', total: 1_500_000, invested: 1_000_000, others: 500_000,
    byAssetClass: { 성장주: 1_000_000, '예적금·공제회': 500_000 },
  });
});

test('기록 정리: 달이 틀리면 버리고, 날짜가 틀리면 그 달 1일, 음수·숫자 아님은 0', () => {
  assert.equal(normalizeSnapshot({ month: '2026-13', invested: 1 }), null);
  assert.equal(normalizeSnapshot({ invested: 1 }), null);
  assert.equal(normalizeSnapshot('2026-10'), null);
  const fixed = normalizeSnapshot({ month: '2026-10', date: '2026-02-30', invested: -5, others: '10' });
  assert.equal(fixed.date, '2026-10-01');
  assert.equal(fixed.total, 0);
});

test('기록 목록 정리: 틀린 기록은 버리고, 같은 달은 마지막 것만, 달 순서대로', () => {
  const list = normalizeSnapshots([snap('2026-10', 3), null, snap('2026-08', 1), { month: 'x' }, snap('2026-10', 5), snap('2026-09', 2)]);
  assert.deepEqual(list.map((item) => [item.month, item.total]), [['2026-08', 1], ['2026-09', 2], ['2026-10', 5]]);
  assert.deepEqual(normalizeSnapshots(undefined), []);
});

test('이번 달 기록 만들기: 기록한 날의 달과 날짜, 자산 요약의 금액', () => {
  const snapshot = createSnapshot(
    { invested: 90_000_000, others: 30_000_000, total: 120_000_000, byAssetClass: { 성장주: 90_000_000, '예적금·공제회': 30_000_000 } },
    new Date(2026, 9, 31),
  );
  assert.deepEqual(snapshot, {
    month: '2026-10', date: '2026-10-31', total: 120_000_000, invested: 90_000_000, others: 30_000_000,
    byAssetClass: { 성장주: 90_000_000, '예적금·공제회': 30_000_000 },
  });
});

test('같은 달에 다시 기록하면 그 달 기록을 바꾸고, 새 달이면 더한다', () => {
  const list = [snap('2026-08', 1), snap('2026-09', 2)];
  assert.deepEqual(upsertSnapshot(list, normalizeSnapshot(snap('2026-09', 7))).map((item) => item.total), [1, 7]);
  assert.deepEqual(upsertSnapshot(list, normalizeSnapshot(snap('2026-10', 3))).map((item) => item.month), ['2026-08', '2026-09', '2026-10']);
  assert.equal(list.length, 2); // 원래 목록은 그대로
});

test('기록 제안: 자산이 있고, 이번 달 기록이 없고, 이번 달에 넘어가기를 누르지 않았을 때만', () => {
  const base = { snapshots: [snap('2026-09', 1)], promptMonth: null, month: '2026-10', total: 100 };
  assert.equal(shouldSuggestSnapshot(base), true);
  assert.equal(shouldSuggestSnapshot({ ...base, total: 0 }), false);
  assert.equal(shouldSuggestSnapshot({ ...base, promptMonth: '2026-10' }), false);
  assert.equal(shouldSuggestSnapshot({ ...base, promptMonth: '2026-09' }), true); // 지난달에 넘어간 건 상관없음
  assert.equal(shouldSuggestSnapshot({ ...base, snapshots: [snap('2026-10', 1)] }), false);
});

test('지난 기록과의 변화: 마지막 두 기록 (2개보다 적으면 없음)', () => {
  assert.equal(latestChange([]), null);
  assert.equal(latestChange([normalizeSnapshot(snap('2026-10', 100))]), null);
  const change = latestChange(normalizeSnapshots([snap('2026-08', 50), snap('2026-09', 100), snap('2026-10', 90, 20)]));
  assert.equal(change.previous.month, '2026-09');
  assert.equal(change.latest.month, '2026-10');
  assert.equal(change.change, 10);
  assert.equal(change.rate, 0.1);
  assert.equal(latestChange(normalizeSnapshots([snap('2026-09', 0), snap('2026-10', 5)])).rate, null);
});
