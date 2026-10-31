// 공제회·예적금, 연금 입력 검증과 저장 데이터 정리
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOtherAsset, otherAssetToInput, validateOtherAsset } from '../js/other-asset.js';
import { normalizePension, pensionToInput, validatePension } from '../js/pension.js';
import {
  ageAt, durationText, formatMonthIndex, isOlderThan, monthIndexAtAge, monthIndexOf, parseMonth, toYearMonth,
} from '../js/dates.js';

const NOW = new Date(2026, 9, 30);

const depositInput = (overrides = {}) => ({
  name: '행정공제회', type: '공제회', principal: '24,000,000', accruedInterest: '6,000,000', baseDate: '2026-10-01', monthlyContribution: '500,000',
  contributionGrowthRate: '', interestRates: { low: '3', base: '4', high: '' }, compounding: '월복리',
  contributionEndDate: '2040-12', payoutDate: '2041-06', applyTax: true, taxRate: '3', ...overrides,
});

test('공제회·예적금: 정상 입력은 저장할 항목이 되고, 갱신일은 오늘', () => {
  const result = validateOtherAsset(depositInput(), { now: NOW });
  assert.equal(result.ok, true);
  const { id, ...rest } = result.value;
  assert.match(id, /^o_/);
  assert.deepEqual(rest, {
    name: '행정공제회', type: '공제회', balance: 30_000_000, accruedInterest: 6_000_000, baseDate: '2026-10-01', monthlyContribution: 500_000,
    contributionGrowthRate: 0, interestRates: { low: 3, base: 4, high: 4 }, compounding: '월복리',
    contributionEndDate: '2040-12', payoutDate: '2041-06', applyTax: true, taxRate: 3, updatedAt: '2026-10-30',
  });
});

test('공제회·예적금: 원금과 지금까지 붙은 이자를 따로 받아 적립금은 그 합계 (이자는 비워도 된다)', () => {
  const noInterest = validateOtherAsset(depositInput({ accruedInterest: '' }), { now: NOW });
  assert.equal(noInterest.ok, true);
  assert.equal(noInterest.value.balance, 24_000_000);
  assert.equal(noInterest.value.accruedInterest, 0);
  assert.match(validateOtherAsset(depositInput({ accruedInterest: '-1' }), { now: NOW }).errors.accruedInterest, /0/);
  // 입력 화면에는 원금과 이자로 나눠서 보여준다
  const input = otherAssetToInput(validateOtherAsset(depositInput(), { now: NOW }).value);
  assert.equal(input.principal, '24000000');
  assert.equal(input.accruedInterest, '6000000');
});

test('공제회·예적금 세금: 켜면 세율이 꼭 필요하고, 끄면 세율 칸은 검사하지 않는다', () => {
  assert.match(validateOtherAsset(depositInput({ taxRate: '' }), { now: NOW }).errors.taxRate, /세율/);
  assert.match(validateOtherAsset(depositInput({ taxRate: '60' }), { now: NOW }).errors.taxRate, /0~50%/);
  assert.equal(validateOtherAsset(depositInput({ taxRate: '15.4' }), { now: NOW }).value.taxRate, 15.4);
  // 끄면 비어 있어도 저장되고, 세율은 종류의 기본값(공제회 3%)으로 둔다
  const off = validateOtherAsset(depositInput({ applyTax: false, taxRate: '' }), { now: NOW });
  assert.equal(off.ok, true);
  assert.equal(off.value.applyTax, false);
  assert.equal(off.value.taxRate, 3);
  // 끈 채로 저장해도 입력해 둔 세율은 남는다 (다시 켤 때 그대로)
  assert.equal(validateOtherAsset(depositInput({ applyTax: false, taxRate: '1.5' }), { now: NOW }).value.taxRate, 1.5);
});

test('공제회·예적금: 필수 항목과 납입 종료 시점', () => {
  const empty = validateOtherAsset(depositInput({ name: '', principal: '', baseDate: '', payoutDate: '', interestRates: {} }), { now: NOW });
  assert.deepEqual(Object.keys(empty.errors).sort(), ['baseDate', 'interestRates', 'name', 'payoutDate', 'principal']);
  assert.match(empty.errors.interestRates, /^기준:/);
  const noEnd = validateOtherAsset(depositInput({ contributionEndDate: '' }), { now: NOW });
  assert.match(noEnd.errors.contributionEndDate, /납입 종료 시점/);
  // 매달 넣는 돈이 없으면 납입 종료 시점은 없어도 된다
  assert.equal(validateOtherAsset(depositInput({ monthlyContribution: '', contributionEndDate: '' }), { now: NOW }).ok, true);
});

test('공제회·예적금: 날짜 순서가 이상하면 저장은 하되 안내한다', () => {
  const past = validateOtherAsset(depositInput({ contributionEndDate: '2025-12' }), { now: NOW });
  assert.equal(past.ok, true);
  assert.match(past.warnings.contributionEndDate, /기준일보다 앞/);
  const early = validateOtherAsset(depositInput({ payoutDate: '2035-01' }), { now: NOW });
  assert.match(early.warnings.payoutDate, /납입 종료보다 빨라요/);
  const unordered = validateOtherAsset(depositInput({ interestRates: { low: '5', base: '4', high: '6' } }), { now: NOW });
  assert.match(unordered.warnings.interestRates, /순서/);
});

test('공제회·예적금: 저장 → 입력값 → 다시 검사하면 같은 항목', () => {
  const saved = validateOtherAsset(depositInput(), { now: NOW }).value;
  assert.deepEqual(validateOtherAsset(otherAssetToInput(saved), { now: NOW }).value, saved);
  assert.deepEqual(normalizeOtherAsset(saved), saved);
});

test('공제회·예적금: 저장 데이터 정리 (빠진 값은 기본값)', () => {
  const asset = normalizeOtherAsset({ id: 'x', name: '예금', balance: 1000, interestRates: { base: 3 } });
  assert.equal(asset.type, '기타');
  assert.equal(asset.compounding, '월복리');
  assert.deepEqual(asset.interestRates, { low: 3, base: 3, high: 3 });
  assert.equal(asset.payoutDate, null);
  // 세금 항목이 없던 예전 데이터: 세금 빼기 켜짐, 세율은 종류별 기본값
  assert.equal(asset.applyTax, true);
  assert.equal(asset.taxRate, 15.4);
  assert.equal(normalizeOtherAsset({ type: '공제회' }).taxRate, 3);
  assert.equal(normalizeOtherAsset({ type: '예금' }).taxRate, 15.4);
  assert.equal(normalizeOtherAsset({ type: '적금', taxRate: 80 }).taxRate, 15.4);
  assert.equal(normalizeOtherAsset({ type: '공제회', applyTax: false, taxRate: 2.2 }).taxRate, 2.2);
  assert.equal(normalizeOtherAsset({ type: '공제회', applyTax: false }).applyTax, false);
  // 이자를 따로 넣지 않았던 예전 데이터는 이자 0원(적립금 전부 원금), 이자가 적립금보다 클 수는 없다
  assert.equal(asset.accruedInterest, 0);
  assert.equal(normalizeOtherAsset({ balance: 100, accruedInterest: 500 }).accruedInterest, 100);
});

const fixedInput = (overrides = {}) => ({
  name: '공무원연금', category: '공무원연금', kind: 'fixed', startAge: '65', payoutType: '종신', payoutYears: '',
  applyTax: true, taxRate: '3.3', memo: '', expectedMonthlyAmount: '2,500,000', amountBasis: 'present', inflationIndexed: true, inquiryDate: '2026-10-01',
  ...overrides,
});
const accInput = (overrides = {}) => ({
  name: '연금저축', category: '연금저축', kind: 'accumulating', startAge: '60', payoutType: '기간 지정', payoutYears: '20',
  applyTax: true, taxRate: '5.5', memo: '', linkedAccount: '', balance: '12,000,000', baseDate: '2026-10-01', monthlyContribution: '300,000',
  contributionEndDate: '2035-12', expectedReturns: { low: '2', base: '4', high: '6' }, ...overrides,
});

test('확정 수령형 연금: 정상 입력, 금액 기준은 꼭 골라야 한다', () => {
  const result = validatePension(fixedInput(), { now: NOW, birthYear: 1975 });
  assert.equal(result.ok, true);
  assert.equal(result.value.expectedMonthlyAmount, 2_500_000);
  assert.equal(result.value.payoutYears, null);
  assert.equal(result.value.updatedAt, '2026-10-30');
  assert.equal('balance' in result.value, false);
  assert.match(validatePension(fixedInput({ amountBasis: '' }), { now: NOW }).errors.amountBasis, /현재가치인지 미래 금액인지/);
});

test('연금 세율: 연금마다 따로, 세금을 켜면 꼭 필요하고 끄면 검사하지 않는다', () => {
  assert.equal(validatePension(fixedInput(), { now: NOW }).value.taxRate, 3.3);
  assert.equal(validatePension(accInput({ taxRate: '4.4' }), { now: NOW }).value.taxRate, 4.4);
  assert.match(validatePension(fixedInput({ taxRate: '' }), { now: NOW }).errors.taxRate, /0~50%/);
  assert.match(validatePension(fixedInput({ taxRate: '51' }), { now: NOW }).errors.taxRate, /0~50%/);
  // 끄면 비어 있어도 저장되고, 세율은 설정의 기본값으로 둔다
  const off = validatePension(fixedInput({ applyTax: false, taxRate: '' }), { now: NOW, defaultTaxRate: 5.5 });
  assert.equal(off.ok, true);
  assert.equal(off.value.taxRate, 5.5);
  // 세율이 없던 예전 데이터는 넘겨준 기본값(설정값)으로 채운다
  assert.equal(normalizePension({ kind: 'fixed' }, { defaultTaxRate: 4.4 }).taxRate, 4.4);
  assert.equal(normalizePension({ kind: 'fixed', taxRate: 3.3 }, { defaultTaxRate: 4.4 }).taxRate, 3.3);
  assert.equal(normalizePension({ kind: 'fixed', taxRate: 99 }).taxRate, 5.5);
});

test('연금: 기간 지정이면 받는 기간이 필요, 이미 받는 나이면 안내', () => {
  assert.match(validatePension(fixedInput({ payoutType: '기간 지정' }), { now: NOW }).errors.payoutYears, /1 ~ 60년/);
  const started = validatePension(fixedInput({ startAge: '60' }), { now: NOW, birthYear: 1960 });
  assert.equal(started.ok, true);
  assert.match(started.warnings.startAge, /이미 받기 시작한/);
});

test('적립형 연금: 정상 입력과 계좌 연결 (연결하면 적립금을 입력하지 않는다)', () => {
  const result = validatePension(accInput(), { now: NOW, birthYear: 1975 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.expectedReturns, { low: 2, base: 4, high: 6 });
  assert.equal(result.value.linkedAccount, null);

  const linked = validatePension(accInput({ linkedAccount: 'IRP', balance: '', baseDate: '' }), { now: NOW });
  assert.equal(linked.ok, true);
  assert.equal(linked.value.linkedAccount, 'IRP');
  assert.equal(linked.value.balance, 0);
  assert.equal(linked.value.baseDate, null);
});

test('적립형 연금: 한 계좌에는 연금 하나만 연결할 수 있다', () => {
  const first = validatePension(accInput({ linkedAccount: 'IRP' }), { now: NOW }).value;
  const second = validatePension(accInput({ name: '다른 연금', linkedAccount: 'IRP' }), { now: NOW, existing: [first] });
  assert.match(second.errors.linkedAccount, /이미 IRP 계좌와 연결/);
  assert.equal(validatePension({ ...accInput({ linkedAccount: 'IRP' }), id: first.id }, { now: NOW, existing: [first] }).ok, true);
});

test('연금: 저장 → 입력값 → 다시 검사하면 같은 연금, 정리해도 그대로', () => {
  for (const input of [fixedInput(), accInput(), accInput({ linkedAccount: '연금저축', balance: '', baseDate: '' })]) {
    const saved = validatePension(input, { now: NOW }).value;
    assert.deepEqual(validatePension(pensionToInput(saved), { now: NOW, existing: [saved] }).value, saved);
    assert.deepEqual(normalizePension(saved), saved);
  }
});

test('연금: 저장 데이터 정리 — 종류에 맞는 항목만 남긴다', () => {
  const pension = normalizePension({ id: 'p', name: 'IRP', kind: 'accumulating', balance: 100, expectedMonthlyAmount: 999, linkedAccount: '없는계좌' });
  assert.equal('expectedMonthlyAmount' in pension, false);
  assert.equal(pension.linkedAccount, null);
  assert.deepEqual(pension.expectedReturns, { low: 0, base: 0, high: 0 });
  assert.equal(pension.applyTax, true);
});

test('날짜 도우미', () => {
  assert.equal(parseMonth('2044-03'), monthIndexOf(2044, 3));
  assert.equal(parseMonth('2044-03-15'), monthIndexOf(2044, 3));
  assert.equal(parseMonth('2044-13'), null);
  assert.equal(parseMonth(null), null);
  assert.equal(toYearMonth(monthIndexOf(2044, 3)), '2044-03');
  assert.equal(ageAt(monthIndexOf(2040, 5), 1980, 6), 59);
  assert.equal(ageAt(monthIndexOf(2040, 6), 1980, 6), 60);
  assert.equal(monthIndexAtAge(65, 1980, 6), monthIndexOf(2045, 6));
  assert.equal(formatMonthIndex(monthIndexOf(2044, 3)), '2044년 3월');
  assert.equal(durationText(62), '5년 2개월');
  assert.equal(durationText(8), '8개월');
  assert.equal(durationText(36), '3년');
  assert.equal(isOlderThan('2025-10-29', 365, NOW), true);
  assert.equal(isOlderThan('2026-01-01', 365, NOW), false);
  assert.equal(isOlderThan(null, 365, NOW), false);
});
