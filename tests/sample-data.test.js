// "샘플 데이터로 둘러보기" 데이터: 저장 구조에 맞고, 날짜는 불러오는 날 기준
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSampleData } from '../js/sample-data.js';
import { normalizeData } from '../js/storage.js';
import { valuePortfolio } from '../js/calc/valuation.js';
import { assetSummary } from '../js/calc/totals.js';

const NOW = new Date(2026, 9, 31);

test('샘플 데이터는 저장 구조 그대로이고 샘플 표시가 붙는다', () => {
  const sample = createSampleData(NOW);
  assert.deepEqual(normalizeData(sample), sample);
  assert.equal(sample.meta.sample, true);
  assert.equal(sample.meta.onboardingDone, true);
  assert.equal(sample.holdings.length, 7);
  assert.ok(sample.holdings.every((holding) => holding.manualPrice > 0), '시트 없이도 계산되게 현재가를 넣어 둠');
  assert.equal(sample.settings.sheetUrl, '');
});

test('샘플 월별 기록은 이번 달 전 6개월, 적립금 기준일은 이번 달 1일', () => {
  const sample = createSampleData(NOW);
  assert.deepEqual(sample.snapshots.map((item) => item.month), ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
  assert.ok(sample.otherAssets.every((asset) => asset.baseDate === '2026-10-01'));
  // 마지막 기록은 지금 총자산보다 조금 적다 (그래프가 오르는 모양)
  const { rows } = valuePortfolio(sample.holdings, { prices: {}, fxRate: sample.settings.manualFxUsdKrw });
  const now = assetSummary({ rows, otherAssets: sample.otherAssets, pensions: sample.pensions });
  assert.ok(sample.snapshots.at(-1).total < now.total);
  assert.ok(sample.snapshots[0].total < sample.snapshots.at(-1).total);
});

test('계좌에 연결한 샘플 연금은 그 계좌에 종목이 있다 (이중 계산 없이 연금으로)', () => {
  const sample = createSampleData(NOW);
  for (const pension of sample.pensions.filter((item) => item.linkedAccount)) {
    assert.ok(sample.holdings.some((holding) => holding.account === pension.linkedAccount), `${pension.linkedAccount} 계좌 종목`);
  }
});
