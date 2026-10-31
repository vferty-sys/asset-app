// 월별 기록(스냅샷, 요청서 3-6): 한 달에 하나씩 날짜, 총자산, 투자자산, 기타 금융자산, 자산군별 금액을 남긴다.

import { todayString } from './dates.js';
import { coerceValue, isPlainObject } from './validate.js';

const wholeWon = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0);

// 틀린 기록이면 null. 총자산은 늘 투자자산 + 기타 금융자산으로 다시 계산한다.
export function normalizeSnapshot(raw) {
  if (!isPlainObject(raw)) return null;
  const month = coerceValue({ type: 'yearMonth' }, raw.month);
  if (!month.ok) return null;
  const date = coerceValue({ type: 'date' }, raw.date);
  const invested = wholeWon(raw.invested);
  const others = wholeWon(raw.others);
  const byAssetClass = {};
  if (isPlainObject(raw.byAssetClass)) {
    for (const [name, value] of Object.entries(raw.byAssetClass)) {
      const amount = wholeWon(value);
      const key = name.trim().slice(0, 40);
      if (amount > 0 && key) byAssetClass[key] = amount;
    }
  }
  return {
    month: month.value,
    date: date.ok ? date.value : `${month.value}-01`,
    total: invested + others,
    invested,
    others,
    byAssetClass,
  };
}

// 저장된 목록 정리: 틀린 기록은 버리고, 같은 달이 여럿이면 마지막 것만 남기고, 달 순서대로
export function normalizeSnapshots(list) {
  const byMonth = new Map();
  for (const raw of Array.isArray(list) ? list : []) {
    const snapshot = normalizeSnapshot(raw);
    if (snapshot) byMonth.set(snapshot.month, snapshot);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

// 지금 자산 요약(calc/totals.js의 assetSummary)으로 이번 달 기록을 만든다
export function createSnapshot(summary, now = new Date()) {
  const date = todayString(now);
  return normalizeSnapshot({
    month: date.slice(0, 7), date, invested: summary.invested, others: summary.others, byAssetClass: summary.byAssetClass,
  });
}

// 같은 달 기록이 있으면 바꾸고, 없으면 더한다
export function upsertSnapshot(snapshots, snapshot) {
  return normalizeSnapshots([...snapshots.filter((item) => item.month !== snapshot.month), snapshot]);
}

// 이번 달 기록을 남기자고 제안할지: 기록할 자산이 있고, 이번 달 기록이 없고, 이번 달에 '넘어가기'를 누르지 않았을 때
export function shouldSuggestSnapshot({ snapshots, promptMonth, month, total }) {
  return total > 0 && promptMonth !== month && !snapshots.some((item) => item.month === month);
}

// 마지막 두 기록 사이의 변화 (기록이 2개보다 적으면 null)
export function latestChange(snapshots) {
  if (snapshots.length < 2) return null;
  const [previous, latest] = snapshots.slice(-2);
  const change = latest.total - previous.total;
  return { previous, latest, change, rate: previous.total > 0 ? change / previous.total : null };
}
