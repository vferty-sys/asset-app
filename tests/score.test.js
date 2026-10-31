import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveHoldings, holdingPieces, gradeFor, linearFraction, scorePortfolio } from '../js/calc/score.js';
import { valuePortfolio } from '../js/calc/valuation.js';
import { DEFAULT_SETTINGS, SCORE_RULES } from '../js/constants.js';

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ''} ${actual} ≠ ${expected}`);

function holding(id, value, overrides = {}) {
  return {
    id, name: id, ticker: `KRX:${id}`, type: 'stock', currency: 'KRW', quantity: 1, avgPrice: value, manualPrice: value,
    account: '일반', assetClass: '성장주', countryMix: { 한국: 100 }, sectorMix: { 기술: 100 }, dividendPerShare: null, memo: '',
    ...overrides,
  };
}
const score = (holdings, settings = DEFAULT_SETTINGS, fxRate = 1000) => scorePortfolio(valuePortfolio(holdings, { fxRate }).rows, settings);
const item = (result, key) => result.items.find((entry) => entry.key === key);

// 삼성전자 40%, QQQ 30%, SCHD 20%, 국고채 ETF 10%
const EXAMPLE = [
  holding('sam', 4_000_000, { name: '삼성전자' }),
  holding('qqq', 3_000_000, {
    name: 'QQQ', type: 'etf', currency: 'USD', quantity: 6, avgPrice: 500, manualPrice: 500,
    countryMix: { 미국: 100 }, sectorMix: { 기술: 50, 통신: 15, 소비재: 35 },
  }),
  holding('schd', 2_000_000, {
    name: 'SCHD', type: 'etf', currency: 'USD', quantity: 80, avgPrice: 25, manualPrice: 25, assetClass: '배당주',
    countryMix: { 미국: 100 }, sectorMix: { 금융: 20, 필수소비재: 20, 헬스케어: 15, 산업재: 15, 에너지: 10, 기타: 20 },
  }),
  holding('bond', 1_000_000, { name: '국고채ETF', type: 'etf', assetClass: '채권', sectorMix: { 채권: 100 } }),
];

// QQQ·SCHD는 분산 정도를 고르지 않아 업종·테마형(3조각), 국고채 ETF는 채권이라 시장 전체형(10조각)
// 실효 종목 수 = 1 / (0.4² + 3×(0.3/3)² + 3×(0.2/3)² + 10×(0.1/10)²) ≈ 4.89
const EXAMPLE_EFFECTIVE = 1 / (0.16 + 0.03 + 0.04 / 3 + 0.001);
const EXAMPLE_COUNT_POINTS = 20 * ((EXAMPLE_EFFECTIVE - 1) / 9);

test('예시 포트폴리오: 항목별 점수와 합계', () => {
  const result = score(EXAMPLE);
  near(item(result, 'count').value, EXAMPLE_EFFECTIVE);
  near(item(result, 'count').points, EXAMPLE_COUNT_POINTS);
  // 상위 3조각: 삼성전자 40% + QQQ 조각 10% × 2 = 60% → 30 × (0.8 - 0.6) / 0.4
  near(item(result, 'top3').value, 0.6);
  near(item(result, 'top3').points, 15);
  // 자산군 HHI = 0.7² + 0.2² + 0.1² = 0.54 → 30 × (1 - 0.54) / 0.75
  near(item(result, 'assetClass').value, 0.54);
  near(item(result, 'assetClass').points, 30 * (0.46 / 0.75));
  // 섹터 최대: 기술 55% (기준 40%) → 10 × (1 - 0.55) / 0.6 = 7.5, 국가 최대 50% (기준 70%) → 10
  near(item(result, 'countrySector').points, 17.5);
  near(result.total, EXAMPLE_COUNT_POINTS + 15 + 18.4 + 17.5);
  assert.equal(result.rounded, 60);
  assert.equal(result.grade.label, '괜찮아요');
});

test('예시 포트폴리오: 감점 사유를 쉬운 문장으로', () => {
  const result = score(EXAMPLE);
  assert.equal(item(result, 'count').reason,
    '실효 종목 수는 4.9개예요(금액 기준, ETF는 분산 정도에 따라 나눠 셈). 보유 종목은 4개지만 금액이 일부 종목에 몰려 있어서 더 적게 셌어요. 금액을 여러 종목에 고르게 나눌수록 10개에 가까워지고 점수가 올라가요.');
  assert.equal(item(result, 'top3').reason,
    '가장 큰 3종목이 전체의 60%예요(삼성전자, QQQ). 40% 이하로 낮추면 만점이에요. ETF는 분산 정도에 따라 여러 종목으로 나눠 셌어요.');
  assert.equal(item(result, 'assetClass').reason,
    '가장 큰 자산군은 성장주로 70%를 차지해요. 한쪽으로 몰려 있어요. 다른 자산군의 비중을 늘리면 점수가 올라가요. (HHI 0.54)');
  assert.equal(item(result, 'countrySector').reason,
    '섹터는 기술이 55%로 기준 40%를 넘었어요. 국가는 가장 큰 한국도 50%로 기준 70% 이하예요.');
});

test('실효 종목 수: 금액 기준, 1개 0점, 10개 이상 20점, 그 사이 선형', () => {
  near(item(score([holding('a', 100)]), 'count').points, 0);
  assert.equal(item(score([holding('a', 100)]), 'count').reason, '종목이 1개뿐이에요. 그 종목이 떨어지면 자산 전체가 흔들려요.');
  near(item(score(Array.from({ length: 4 }, (_, i) => holding(`s${i}`, 100))), 'count').points, 20 * (3 / 9));
  near(item(score(Array.from({ length: 12 }, (_, i) => holding(`s${i}`, 100))), 'count').points, 20);
  assert.match(item(score(Array.from({ length: 12 }, (_, i) => holding(`s${i}`, 100))), 'count').reason, /10개 이상이라 만점/);
  // ETF 하나는 분산 정도만큼: 업종·테마형(고르지 않았을 때도) 3종목, 시장 전체형 10종목, 집중형 1종목
  near(item(score([holding('etf', 100, { type: 'etf' })]), 'count').value, 3);
  near(item(score([holding('etf', 100, { type: 'etf' })]), 'count').points, 20 * (2 / 9));
  near(item(score([holding('etf', 100, { type: 'etf', etfSpread: 'market' })]), 'count').points, 20);
  near(item(score([holding('etf', 100, { type: 'etf', etfSpread: 'single' })]), 'count').points, 0);
  // 같은 종목을 두 계좌에 나눠 가져도 1개
  const twoAccounts = [holding('a', 100, { ticker: 'KRX:1' }), holding('b', 100, { ticker: 'KRX:1', account: 'ISA' })];
  near(item(score(twoAccounts), 'count').value, 1);
});

test('실효 종목 수: 아주 작은 금액만 담은 종목·ETF로는 점수가 거의 오르지 않는다', () => {
  // 삼성전자 97% + ETF 3개 각 1% — 개수로 세던 예전 규칙에서는 10개 만점이었다
  const tinyEtfs = [holding('sam', 9_700), ...['e1', 'e2', 'e3'].map((id) => holding(id, 100, { type: 'etf' }))];
  const tiny = item(score(tinyEtfs), 'count');
  near(tiny.value, 1 / (0.97 ** 2 + 3 * 3 * (0.01 / 3) ** 2));
  assert.ok(tiny.points < 0.2, String(tiny.points));
  assert.match(tiny.reason, /보유 종목은 4개지만 금액이 일부 종목에 몰려/);

  // 한 종목 91% + 9종목 1%씩 → 약 1.2개
  const tinyStocks = [holding('big', 9_100), ...Array.from({ length: 9 }, (_, i) => holding(`t${i}`, 100))];
  near(item(score(tinyStocks), 'count').value, 1 / (0.91 ** 2 + 9 * 0.01 ** 2));

  // 97% + 1%×3 이 70% + 30%보다 점수가 낮다 (예전 규칙에서는 거꾸로였다)
  const seventyThirty = [holding('sam', 7_000), holding('etf', 3_000, { type: 'etf' })];
  assert.ok(score(tinyEtfs).total < score(seventyThirty).total);
});

test('effectiveHoldings: 1 / Σ비중², ETF는 나눈 조각(parts)으로 센다', () => {
  near(effectiveHoldings([{ type: 'stock', weight: 0.5 }, { type: 'stock', weight: 0.5 }]), 2);
  near(effectiveHoldings([{ type: 'stock', weight: 0.7 }, { type: 'stock', weight: 0.3 }]), 1 / 0.58);
  near(effectiveHoldings([{ type: 'etf', parts: 3, weight: 1 }]), 3);
  near(effectiveHoldings([{ type: 'etf', parts: 10, weight: 1 }]), 10);
  near(effectiveHoldings([{ type: 'etf', parts: 1, weight: 1 }]), 1);
  assert.equal(effectiveHoldings([]), 0);
});

test('holdingPieces: ETF를 분산 정도만큼 똑같이 나눈 조각으로 펼쳐 큰 순서로', () => {
  const pieces = holdingPieces([{ name: 'S&P500', type: 'etf', parts: 10, weight: 0.5 }, { name: '삼성전자', type: 'stock', weight: 0.5 }]);
  assert.equal(pieces.length, 11);
  assert.equal(pieces[0].name, '삼성전자');
  near(pieces[1].weight, 0.05);
});

test('상위 3종목 집중도: 40% 이하 30점, 80% 이상 0점, 그 사이 선형', () => {
  const ten = Array.from({ length: 10 }, (_, i) => holding(`s${i}`, 100));
  near(item(score(ten), 'top3').points, 30); // 30%
  const sixty = [holding('a', 20), holding('b', 20), holding('c', 20), holding('d', 20), holding('e', 20)];
  near(item(score(sixty), 'top3').value, 0.6);
  near(item(score(sixty), 'top3').points, 15);
  assert.match(item(score([holding('a', 1), holding('b', 1)]), 'top3').reason, /종목이 2개라/);
});

test('상위 3종목 집중도: ETF는 분산 정도에 따라 나눠 센다 (사용자와 정한 예)', () => {
  const etf = (id, value, etfSpread, overrides = {}) => holding(id, value, { name: id, type: 'etf', etfSpread, ...overrides });
  // A: S&P500 50% + 코스피200 30%(시장 전체형) + 국고채 20% → 5%씩 3조각 = 15% → 만점
  const a = [etf('S&P500', 50, 'market'), etf('코스피200', 30, 'market'), etf('국고채', 20, 'theme', { assetClass: '채권' })];
  near(item(score(a), 'top3').value, 0.15);
  near(item(score(a), 'top3').points, 30);
  // B: 개별 주식 50 + 30 + 20 → 100% → 0점
  near(item(score([holding('a', 50), holding('b', 30), holding('c', 20)]), 'top3').points, 0);
  // C: 테마 ETF 하나에 100% → 33%씩 3조각 = 100% → 0점
  near(item(score([etf('2차전지', 100, 'theme')]), 'top3').points, 0);
});

test('자산군 분산 HHI: 0.25 이하 30점, 1.0이면 0점', () => {
  const four = ['성장주', '배당주', '채권', '현금성'].map((assetClass, i) => holding(`s${i}`, 100, { assetClass }));
  near(item(score(four), 'assetClass').value, 0.25);
  near(item(score(four), 'assetClass').points, 30);
  near(item(score([holding('a', 100)]), 'assetClass').points, 0);
  assert.match(item(score([holding('a', 100)]), 'assetClass').reason, /한 자산군에만/);
  const two = [holding('a', 100), holding('b', 100, { assetClass: '채권' })];
  near(item(score(two), 'assetClass').points, 30 * (0.5 / 0.75));
});

test('국가·섹터 쏠림: 기준 이하면 10점씩, 100%면 0점, 기준은 설정을 따른다', () => {
  const allKorea = [holding('a', 50, { sectorMix: { 기술: 100 } }), holding('b', 50, { sectorMix: { 금융: 100 } })];
  // 섹터 최대 50% (기준 40%) → 10 × 0.5/0.6, 국가 한국 100% → 0
  near(item(score(allKorea), 'countrySector').points, 10 * (0.5 / 0.6));
  near(item(score(allKorea, { ...DEFAULT_SETTINGS, warnSector: 50, warnCountry: 100 }), 'countrySector').points, 20);
});

test('섹터가 모두 기타·미분류면 섹터 쏠림은 감점하지 않는다', () => {
  const result = score([holding('a', 100, { sectorMix: { 기타: 100 }, countryMix: { 미국: 50, 한국: 50 } })]);
  near(item(result, 'countrySector').points, 20);
  assert.match(item(result, 'countrySector').reason, /섹터 정보가 없어요/);
});

test('점수 구간: 80 이상 튼튼해요 / 60~79 괜찮아요 / 40~59 점검이 필요해요 / 40 미만 쏠림이 커요', () => {
  assert.equal(gradeFor(100).label, '튼튼해요');
  assert.equal(gradeFor(80).label, '튼튼해요');
  assert.equal(gradeFor(79.5).label, '튼튼해요'); // 화면에 80점으로 보이므로
  assert.equal(gradeFor(79.4).label, '괜찮아요');
  assert.equal(gradeFor(60).label, '괜찮아요');
  assert.equal(gradeFor(59).label, '점검이 필요해요');
  assert.equal(gradeFor(40).label, '점검이 필요해요');
  assert.equal(gradeFor(39.4).label, '쏠림이 커요');
  assert.equal(gradeFor(0).label, '쏠림이 커요');
});

test('평가금액이 있는 종목이 없으면 점수 없음', () => {
  assert.equal(score([]), null);
  assert.equal(score([holding('usd', 100, { currency: 'USD' })], DEFAULT_SETTINGS, null), null);
});

test('배점 합계는 100점', () => {
  const max = SCORE_RULES.count.points + SCORE_RULES.top3.points + SCORE_RULES.assetClass.points + SCORE_RULES.countrySector.pointsEach * 2;
  assert.equal(max, 100);
  assert.equal(score(EXAMPLE).items.reduce((sum, entry) => sum + entry.max, 0), 100);
});

test('linearFraction', () => {
  near(linearFraction(0.6, 0.4, 0.8), 0.5);
  assert.equal(linearFraction(0.3, 0.4, 0.8), 1);
  assert.equal(linearFraction(0.9, 0.4, 0.8), 0);
  near(linearFraction(4, 10, 1), 3 / 9);
});
