import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  guessEtfSpread, guessFromTicker, holdingKey, holdingToInput, isMixComplete, normalizeHolding, normalizeTicker,
  validateHolding, validateMix,
} from '../js/holding.js';

const baseInput = (overrides = {}) => ({
  name: '삼성전자',
  ticker: 'krx:005930',
  type: 'stock',
  currency: 'KRW',
  quantity: '10',
  avgPrice: '61,000',
  manualPrice: '',
  account: '일반',
  assetClass: '성장주',
  countryRows: [{ name: '한국', percent: 100 }],
  sectorRows: [{ name: '기술', percent: 100 }],
  dividendPerShare: '',
  memo: '',
  ...overrides,
});

test('정상 입력은 저장할 종목 객체가 된다', () => {
  const result = validateHolding(baseInput());
  assert.equal(result.ok, true);
  const { id, ...rest } = result.value;
  assert.match(id, /^h_/);
  assert.deepEqual(rest, {
    name: '삼성전자',
    ticker: 'KRX:005930',
    type: 'stock',
    etfSpread: null,
    currency: 'KRW',
    quantity: 10,
    avgPrice: 61000,
    manualPrice: null,
    account: '일반',
    assetClass: '성장주',
    countryMix: { 한국: 100 },
    countryPreset: null,
    sectorMix: { 기술: 100 },
    dividendPerShare: null,
    memo: '',
  });
});

test('필수 항목이 비면 항목별 오류를 돌려준다', () => {
  const result = validateHolding(baseInput({ name: ' ', ticker: '', quantity: '', avgPrice: 'abc', assetClass: '' }));
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result.errors).sort(), ['assetClass', 'avgPrice', 'name', 'quantity', 'ticker']);
  assert.equal(result.errors.assetClass, '목록에서 골라 주세요.');
});

test('국내 6자리 종목번호만 적으면 거래소를 붙이라고 안내한다', () => {
  const result = validateHolding(baseInput({ ticker: '005930' }));
  assert.match(result.errors.ticker, /KRX:005930/);
  assert.equal(validateHolding(baseInput({ ticker: 'KRX 005930!' })).ok, false);
  assert.equal(validateHolding(baseInput({ ticker: 'QQQ', currency: 'USD' })).ok, true);
});

test('수량: 국내 주식은 정수만, 미국 주식 소수점은 설정을 켰을 때만', () => {
  assert.match(validateHolding(baseInput({ quantity: '1.5' })).errors.quantity, /소수점 없이/);
  const usd = baseInput({ ticker: 'NASDAQ:QQQ', currency: 'USD', quantity: '0.5', countryRows: [{ name: '미국', percent: 100 }] });
  assert.match(validateHolding(usd).errors.quantity, /설정/);
  assert.equal(validateHolding(usd, { allowFractionalUS: true }).ok, true);
  assert.equal(validateHolding(baseInput({ quantity: '0' })).ok, true);
  assert.equal(validateHolding(baseInput({ quantity: '-1' })).ok, false);
});

test('직접 입력한 현재가는 0보다 커야 한다', () => {
  assert.equal(validateHolding(baseInput({ manualPrice: '0' })).ok, false);
  assert.equal(validateHolding(baseInput({ manualPrice: '70,000' })).value.manualPrice, 70000);
});

test('같은 계좌에 같은 종목은 중복 등록할 수 없다 (수정 중인 자기 자신은 제외)', () => {
  const saved = validateHolding(baseInput()).value;
  const duplicate = validateHolding(baseInput(), { existing: [saved] });
  assert.match(duplicate.errors.ticker, /이미 있는 종목/);
  assert.equal(validateHolding(baseInput({ account: 'ISA' }), { existing: [saved] }).ok, true);
  assert.equal(validateHolding({ ...baseInput(), id: saved.id }, { existing: [saved] }).ok, true);
});

test('개별 주식: 국가·섹터는 하나만, 자동으로 100%', () => {
  assert.deepEqual(validateMix([{ name: '미국', percent: '' }], { label: '국가', single: true }), { value: { 미국: 100 } });
  assert.deepEqual(validateMix([{ name: '미국', percent: 60 }], { label: '국가', single: true }), { value: { 미국: 100 } });
  assert.match(validateMix([{ name: '미국', percent: 60 }, { name: '한국', percent: 40 }], { label: '국가', single: true }).error, /ETF/);
});

test('ETF: 비율을 나눠 입력하고, 합계가 100이 아니면 경고만 한다', () => {
  const ok = validateMix([{ name: '기술', percent: '50' }, { name: '통신', percent: 15 }, { name: '소비재', percent: 35 }], { label: '섹터' });
  assert.deepEqual(ok, { value: { 기술: 50, 통신: 15, 소비재: 35 }, warning: null });
  const partial = validateMix([{ name: '기술', percent: 50 }, { name: '통신', percent: 35 }], { label: '섹터' });
  assert.deepEqual(partial.value, { 기술: 50, 통신: 35 });
  assert.match(partial.warning, /85%/);
  const result = validateHolding(baseInput({ type: 'etf', sectorRows: [{ name: '기술', percent: 50 }, { name: '통신', percent: 35 }] }));
  assert.equal(result.ok, true);
  assert.match(result.warnings.sectorMix, /85%/);
});

test('비율 입력 오류: 빈 목록, 이름 없음, 범위 밖, 중복', () => {
  assert.match(validateMix([], { label: '국가' }).error, /골라/);
  assert.match(validateMix([{ name: '', percent: 50 }], { label: '국가' }).error, /이름/);
  assert.match(validateMix([{ name: '미국', percent: 0 }], { label: '국가' }).error, /0보다 크고/);
  assert.match(validateMix([{ name: '미국', percent: 101 }], { label: '국가' }).error, /100 이하/);
  assert.match(validateMix([{ name: '미국', percent: 50 }, { name: '미국', percent: 50 }], { label: '국가' }).error, /두 번/);
  // 이름과 비율이 모두 빈 줄은 무시한다
  assert.deepEqual(validateMix([{ name: '미국', percent: 100 }, { name: '', percent: '' }], { label: '국가' }).value, { 미국: 100 });
});

test('티커 정리와 거래소로 통화·국가 짐작', () => {
  assert.equal(normalizeTicker(' nasdaq: qqq '), 'NASDAQ:QQQ');
  assert.deepEqual(guessFromTicker('KRX:005930'), { currency: 'KRW', country: '한국' });
  assert.deepEqual(guessFromTicker('kosdaq:247540'), { currency: 'KRW', country: '한국' });
  assert.deepEqual(guessFromTicker('NYSEARCA:SCHD'), { currency: 'USD', country: '미국' });
  assert.equal(guessFromTicker('QQQ'), null);
  assert.equal(guessFromTicker('LON:VOD'), null);
  assert.equal(holdingKey({ ticker: 'krx:005930', account: 'ISA' }), 'KRX:005930|ISA');
});

test('normalizeHolding: 저장 데이터의 틀린 값은 기본값으로, 비율의 이상한 값은 버린다', () => {
  const holding = normalizeHolding({
    id: 'x1', name: '테스트', ticker: 'nasdaq:qqq', type: 'fund', currency: 'USD', quantity: -3,
    avgPrice: '100', manualPrice: 0, account: '일반', assetClass: '성장주',
    countryMix: { 미국: 100, 한국: -5, 일본: 'x' }, sectorMix: null, extra: true,
  });
  assert.deepEqual(holding, {
    id: 'x1', name: '테스트', ticker: 'NASDAQ:QQQ', type: 'stock', etfSpread: null, currency: 'USD', quantity: 0,
    avgPrice: 100, manualPrice: null, account: '일반', assetClass: '성장주',
    countryMix: { 미국: 100 }, countryPreset: null, sectorMix: {}, dividendPerShare: null, memo: '',
  });
  assert.match(normalizeHolding({}).id, /^h_/);
});

test('저장된 종목 → 입력값 → 다시 검사하면 같은 종목', () => {
  const saved = validateHolding(baseInput({ type: 'etf', manualPrice: '70000', dividendPerShare: '1444', memo: '메모' })).value;
  const again = validateHolding(holdingToInput(saved), { existing: [saved] });
  assert.equal(again.ok, true);
  assert.deepEqual(again.value, saved);
});

test('ETF 분산 정도: 고르면 그대로, 안 고르면 종목명·티커로 짐작, 개별 주식은 없음', () => {
  assert.equal(validateHolding(baseInput({ type: 'etf', name: '2차전지 ETF', etfSpread: 'market' })).value.etfSpread, 'market');
  assert.equal(validateHolding(baseInput({ type: 'etf', name: 'KODEX 200', etfSpread: '' })).value.etfSpread, 'market');
  assert.equal(validateHolding(baseInput({ type: 'etf', name: 'KODEX 2차전지산업' })).value.etfSpread, 'theme');
  assert.equal(validateHolding(baseInput({ type: 'stock', etfSpread: 'market' })).value.etfSpread, null);
  assert.equal(validateHolding(baseInput({ type: 'etf', etfSpread: '이상한값' })).ok, false);
  // 예전 데이터(분산 정도 없음)도 이름으로 짐작해 채운다
  assert.equal(normalizeHolding({ name: 'TIGER 미국S&P500', ticker: 'KRX:360750', type: 'etf' }).etfSpread, 'market');
  assert.equal(normalizeHolding({ name: 'X', ticker: 'NASDAQ:QQQ', type: 'etf', etfSpread: 'single' }).etfSpread, 'single');
});

test('ETF 분산 정도 짐작: 집중형(레버리지·인버스) → 시장 전체형(시장 지수) → 그 밖은 업종·테마형', () => {
  const cases = {
    'KODEX 200': 'market', 'TIGER 200TR': 'market', 'TIGER 미국S&P500': 'market', 'KODEX 미국나스닥100TR': 'market',
    'KODEX MSCI World': 'market', 'KODEX 코스닥150': 'market', 'KODEX 코스피': 'market',
    'TIGER 200 IT': 'theme', 'KODEX 2차전지산업': 'theme', 'TIGER 미국배당다우존스': 'theme', 'TIGER 미국테크TOP10': 'theme',
    'KODEX 레버리지': 'single', 'KODEX 인버스': 'single', 'TIGER 200 에너지화학레버리지': 'single',
  };
  for (const [name, expected] of Object.entries(cases)) assert.equal(guessEtfSpread({ name }), expected, name);
  assert.equal(guessEtfSpread({ name: 'QQQ', ticker: 'NASDAQ:QQQ' }), 'market');
  assert.equal(guessEtfSpread({ name: 'VOO', ticker: 'NYSEARCA:VOO' }), 'market');
  assert.equal(guessEtfSpread({ name: 'SCHD', ticker: 'NYSEARCA:SCHD' }), 'theme');
  assert.equal(guessEtfSpread({ name: 'TQQQ', ticker: 'NASDAQ:TQQQ' }), 'single');
});

test('isMixComplete', () => {
  assert.equal(isMixComplete({ 미국: 60, 한국: 40 }), true);
  assert.equal(isMixComplete({ 미국: 60 }), false);
  assert.equal(isMixComplete({}), false);
});

test('ETF 국가 비중표: 항목을 고르면 비중표로 나누고, 없는 항목은 오류, 개별 주식은 무시', () => {
  const etf = (overrides) => baseInput({ name: 'KODEX 선진국MSCI World', ticker: 'KRX:251350', type: 'etf', countryRows: [], ...overrides });
  const picked = validateHolding(etf({ countryPreset: 'MSCI World' }));
  assert.equal(picked.ok, true);
  assert.equal(picked.value.countryPreset, 'MSCI World');
  assert.equal(picked.value.countryMix.미국, 72);
  assert.equal(Object.values(picked.value.countryMix).reduce((sum, value) => sum + value, 0), 100);

  const unknown = validateHolding(etf({ countryPreset: '없는 지수' }));
  assert.equal(unknown.ok, false);
  assert.match(unknown.errors.countryMix, /비중표에 없는 항목/);

  // 비중표를 고르지 않았으면 비율 줄을 검사한다
  assert.match(validateHolding(etf({ countryPreset: '' })).errors.countryMix, /국가를 골라/);

  const stock = validateHolding(baseInput({ countryPreset: 'MSCI World' }));
  assert.equal(stock.value.countryPreset, null);
  assert.deepEqual(stock.value.countryMix, { 한국: 100 });

  // 저장 → 입력값 → 다시 검사해도 그대로
  const again = validateHolding(holdingToInput(picked.value), { existing: [picked.value] });
  assert.deepEqual(again.value, picked.value);
});

test('normalizeHolding: ETF의 비중표 항목은 (비중표에서 빠진 이름도) 그대로 두고, 개별 주식은 버린다', () => {
  assert.equal(normalizeHolding({ type: 'etf', countryPreset: 'MSCI ACWI' }).countryPreset, 'MSCI ACWI');
  assert.equal(normalizeHolding({ type: 'etf', countryPreset: '예전 지수' }).countryPreset, '예전 지수');
  assert.equal(normalizeHolding({ type: 'etf', countryPreset: 3 }).countryPreset, null);
  assert.equal(normalizeHolding({ type: 'stock', countryPreset: 'MSCI ACWI' }).countryPreset, null);
});
