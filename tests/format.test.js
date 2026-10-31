import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatMoney, formatNumber, formatPrice, formatPercent, formatPercentShort, formatDate, formatYearMonth, formatQuoteTime,
  josa, pnlClass, EMPTY,
} from '../js/format.js';

test('안내 문장용 짧은 퍼센트', () => {
  assert.equal(formatPercentShort(0.52), '52%');
  assert.equal(formatPercentShort(0.404), '40.4%');
  assert.equal(formatPercentShort(0.12345), '12.3%');
  assert.equal(formatPercentShort(1), '100%');
  assert.equal(formatPercentShort(null), EMPTY);
});

test('받침에 맞는 조사', () => {
  assert.equal(josa('한국', '이', '가'), '이');
  assert.equal(josa('기술주', '이', '가'), '가');
  assert.equal(josa('채권', '으로', '로'), '으로');
  assert.equal(josa('성장주', '으로', '로'), '로');
  assert.equal(josa('서울', '으로', '로'), '로'); // ㄹ 받침
  assert.equal(josa('서울', '이', '가'), '이');
  assert.equal(josa('QQQ', '이', '가'), '가');
});

test('formatMoney 자동 단위: 원 → 만원 → 억원', () => {
  assert.equal(formatMoney(0), '0원');
  assert.equal(formatMoney(9999), '9,999원');
  assert.equal(formatMoney(12345), '1만원');
  assert.equal(formatMoney(23_456_789), '2,346만원');
  assert.equal(formatMoney(123_456_789), '1억 2,346만원');
  assert.equal(formatMoney(300_000_000), '3억원');
  assert.equal(formatMoney(1_234_500_000_000), '12,345억원');
});

test('formatMoney 반올림 경계: 만원 반올림 결과가 1억이 되면 억원으로 표시', () => {
  assert.equal(formatMoney(99_995_000), '1억원');
  assert.equal(formatMoney(99_994_999), '9,999만원');
  assert.equal(formatMoney(9999.6), '1만원');
});

test('formatMoney 음수와 부호 표시', () => {
  assert.equal(formatMoney(-123_456_789), '-1억 2,346만원');
  assert.equal(formatMoney(5_000_000, { signed: true }), '+500만원');
  assert.equal(formatMoney(-5_000, { signed: true }), '-5,000원');
  assert.equal(formatMoney(0, { signed: true }), '0원');
  assert.equal(formatMoney(-0.3), '0원');
});

test('formatMoney 고정 단위', () => {
  assert.equal(formatMoney(123_456_789, { unit: 'won' }), '123,456,789원');
  assert.equal(formatMoney(123_456_789, { unit: 'man' }), '12,346만원');
  assert.equal(formatMoney(5_000, { unit: 'man' }), '5,000원');
});

test('값이 없거나 숫자가 아니면 대시를 보여준다', () => {
  for (const value of [null, undefined, NaN, Infinity, '1000']) {
    assert.equal(formatMoney(value), EMPTY);
    assert.equal(formatNumber(value), EMPTY);
    assert.equal(formatPercent(value), EMPTY);
    assert.equal(formatPrice(value, 'KRW'), EMPTY);
  }
});

test('formatPrice 통화별 표시', () => {
  assert.equal(formatPrice(61000, 'KRW'), '61,000원');
  assert.equal(formatPrice(512.3, 'USD'), '$512.30');
  assert.equal(formatPrice(1234.567, 'USD'), '$1,234.57');
});

test('formatPercent는 비율(0~1)을 받는다', () => {
  assert.equal(formatPercent(0.523), '52.3%');
  assert.equal(formatPercent(1), '100.0%');
  assert.equal(formatPercent(0.12345, { digits: 2 }), '12.35%');
  assert.equal(formatPercent(0.05, { signed: true }), '+5.0%');
  assert.equal(formatPercent(-0.05, { signed: true }), '-5.0%');
  assert.equal(formatPercent(-0.0001, { signed: true }), '0.0%');
});

test('날짜 표시', () => {
  assert.equal(formatDate('2026-10-30'), '2026.10.30');
  assert.equal(formatDate('2026-10-30T10:00:00+09:00'), '2026.10.30');
  assert.equal(formatDate(new Date(2026, 0, 5)), '2026.01.05');
  assert.equal(formatDate('잘못된 값'), EMPTY);
  assert.equal(formatYearMonth('2044-06'), '2044년 6월');
  assert.equal(formatYearMonth('2044-6'), EMPTY);
});

test('시세 시각: 오늘이면 시:분, 다른 날이면 월/일까지', () => {
  const now = new Date(2026, 9, 30, 15, 0);
  assert.equal(formatQuoteTime(new Date(2026, 9, 30, 10, 5).toISOString(), now), '10:05');
  assert.equal(formatQuoteTime(new Date(2026, 9, 29, 9, 30).toISOString(), now), '10/29 09:30');
  assert.equal(formatQuoteTime(null, now), EMPTY);
  assert.equal(formatQuoteTime('잘못된 값', now), EMPTY);
});

test('pnlClass', () => {
  assert.equal(pnlClass(100), 'is-gain');
  assert.equal(pnlClass(-1), 'is-loss');
  assert.equal(pnlClass(0), 'is-flat');
  assert.equal(pnlClass(null), 'is-flat');
});
