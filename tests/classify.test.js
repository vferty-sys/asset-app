// 종목 자동 분류 규칙: 국내 업종·미국 GICS 섹터 → 앱 섹터, 개별 주식 자산군, ETF 이름·분류로 국가·섹터·자산군·분산 정도
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROX_COUNTRY_MIXES, APPROX_SECTOR_MIXES, classifyEtf, sectorFromGics, sectorFromKrIndustry, stockAssetClass,
} from '../js/classify.js';
import { COUNTRY_OPTIONS, SECTOR_OPTIONS } from '../js/constants.js';

test('대략값 비율은 모두 합계 100이고 앱의 국가·섹터 이름만 쓴다', () => {
  for (const [key, mix] of Object.entries(APPROX_SECTOR_MIXES)) {
    assert.equal(Object.values(mix).reduce((sum, value) => sum + value, 0), 100, key);
    assert.ok(Object.keys(mix).every((name) => SECTOR_OPTIONS.includes(name)), key);
  }
  for (const [key, mix] of Object.entries(APPROX_COUNTRY_MIXES)) {
    assert.equal(Object.values(mix).reduce((sum, value) => sum + value, 0), 100, key);
    assert.ok(Object.keys(mix).every((name) => COUNTRY_OPTIONS.includes(name)), key);
  }
});

test('국내 업종(네이버 금융) → 앱 섹터', () => {
  const cases = {
    반도체와반도체장비: '기술', 'IT서비스': '기술', 양방향미디어와서비스: '통신', 게임엔터테인먼트: '통신',
    은행: '금융', 생명보험: '금융', 제약: '헬스케어', 생물공학: '헬스케어',
    자동차: '소비재', 전자제품: '소비재', '섬유,의류,신발,호화품': '소비재', 화장품: '필수소비재', 담배: '필수소비재',
    전기제품: '산업재', 조선: '산업재', 우주항공과국방: '산업재', 화학: '소재', 철강: '소재',
    석유와가스: '에너지', 전기유틸리티: '유틸리티', 부동산: '부동산',
  };
  for (const [industry, sector] of Object.entries(cases)) assert.equal(sectorFromKrIndustry(industry), sector, industry);
});

test('국내 업종: 표에 없는 이름은 낱말로 짐작', () => {
  const cases = {
    '반도체 제조업': '기술', '통신 및 방송 장비 제조업': '기술', '소프트웨어 개발 및 공급업': '기술',
    '자료처리, 호스팅, 포털 및 기타 인터넷 정보매개 서비스업': '통신', '전기 통신업': '통신', '오디오물 출판 및 원판 녹음업': '통신',
    '은행 및 저축기관': '금융', '보험업': '금융', '기타 금융업': '금융',
    '의약품 제조업': '헬스케어', '의료용 기기 제조업': '헬스케어',
    '자동차용 엔진 및 자동차 제조업': '소비재', '종합 소매업': '소비재',
    '기타 식품 제조업': '필수소비재', '일차전지 및 축전지 제조업': '산업재', '선박 및 보트 건조업': '산업재',
    '기초 화학물질 제조업': '소재', '1차 철강 제조업': '소재', '석유 정제품 제조업': '에너지',
    '전기업': '유틸리티', '부동산 임대 및 공급업': '부동산', '알 수 없는 업종': '기타',
  };
  for (const [industry, sector] of Object.entries(cases)) assert.equal(sectorFromKrIndustry(industry), sector, industry);
});

test('미국 GICS 섹터 → 앱 섹터', () => {
  assert.equal(sectorFromGics('Information Technology'), '기술');
  assert.equal(sectorFromGics('Communication Services'), '통신');
  assert.equal(sectorFromGics('Consumer Staples'), '필수소비재');
  assert.equal(sectorFromGics('Real Estate'), '부동산');
  assert.equal(sectorFromGics('???'), '기타');
});

test('개별 주식 자산군: 은행·보험은 배당주, 리츠는 기타, 그 밖은 성장주', () => {
  assert.equal(stockAssetClass({ detail: '은행 및 저축기관' }), '배당주');
  assert.equal(stockAssetClass({ detail: 'Diversified Banks' }), '배당주');
  assert.equal(stockAssetClass({ detail: 'Property & Casualty Insurance' }), '배당주');
  assert.equal(stockAssetClass({ name: 'SK리츠', detail: '부동산 임대 및 공급업' }), '기타');
  assert.equal(stockAssetClass({ detail: 'Retail REITs' }), '기타');
  assert.equal(stockAssetClass({ detail: '반도체 제조업' }), '성장주');
});

test('ETF 자산군: 현금성 → 채권 → 기타(금·원자재·리츠·인버스) → 배당주(배당·커버드콜·은행) → 성장주', () => {
  const cases = {
    'TIGER CD금리투자KIS(합성)': '현금성', 'KODEX KOFR금리액티브(합성)': '현금성', 'SGOV 0-3 Month Treasury Bond': '현금성',
    'KODEX 국고채3년': '채권', 'ACE 미국30년국채액티브': '채권',
    'KODEX 골드선물(H)': '기타', 'TIGER 리츠부동산인프라': '기타', 'KODEX 200선물인버스2X': '기타',
    'TIGER 미국배당다우존스': '배당주', 'KODEX 미국배당커버드콜액티브': '배당주', 'KODEX 은행': '배당주',
    'KODEX 200': '성장주', 'KODEX 반도체': '성장주', 'KODEX 레버리지': '성장주',
  };
  for (const [name, assetClass] of Object.entries(cases)) assert.equal(classifyEtf(name).assetClass, assetClass, name);
  // 거래소가 준 기초자산 분류가 있으면 그것도 쓴다
  assert.equal(classifyEtf('KODEX 종합채권(AA-이상)액티브', { assetType: '채권' }).assetClass, '채권');
  assert.equal(classifyEtf('어떤 ETF', { assetType: '원자재' }).assetClass, '기타');
  const gold = classifyEtf('SOL 국제금', { assetType: '원자재' });
  assert.deepEqual([gold.countryMix, gold.sectorMix], [{ 기타: 100 }, { 기타: 100 }]);
});

test('ETF 국가: 국내 시장이면 한국, 해외는 이름으로, 전세계·선진국·신흥국은 대략적인 나눔', () => {
  assert.deepEqual(classifyEtf('KODEX 반도체', { market: '국내' }).countryMix, { 한국: 100 });
  assert.deepEqual(classifyEtf('TIGER 미국S&P500', { market: '해외' }).countryMix, { 미국: 100 });
  assert.deepEqual(classifyEtf('TIGER 차이나전기차SOLACTIVE').countryMix, { 중국: 100 });
  assert.deepEqual(classifyEtf('ACE 일본니케이225(H)').countryMix, { 일본: 100 });
  assert.deepEqual(classifyEtf('KODEX 인도Nifty50').countryMix, { 신흥국: 100 });
  const world = classifyEtf('KODEX MSCI World');
  assert.deepEqual(world.countryMix, APPROX_COUNTRY_MIXES.world);
  assert.equal(world.approx, true);
  assert.deepEqual(classifyEtf('KODEX 골드선물(H)', { market: '해외' }).countryMix, { 기타: 100 });
  assert.equal(classifyEtf('이름에 단서 없음').countryMix, null);
  assert.deepEqual(classifyEtf('이름에 단서 없음', { market: '해외' }).countryMix, { 기타: 100 });
  // 국내에만 있는 금리·채권 이름은 한국, TDF는 전세계 대략값
  assert.deepEqual(classifyEtf('KODEX 머니마켓액티브').countryMix, { 한국: 100 });
  assert.deepEqual(classifyEtf('TIGER CD1년금리액티브(합성)').countryMix, { 한국: 100 });
  assert.deepEqual(classifyEtf('KODEX 국고채3년').countryMix, { 한국: 100 });
  assert.deepEqual(classifyEtf('TIGER 미국달러단기채권액티브').countryMix, { 미국: 100 });
  assert.deepEqual(classifyEtf('KODEX TDF2050액티브 적격').countryMix, APPROX_COUNTRY_MIXES.allCountry);
  // 이름에 나라 단서가 없을 때 쓸 나라 (국내 채권 ETF)
  assert.deepEqual(classifyEtf('KODEX 종합채권(AA-이상)액티브', { assetType: '채권', fallbackCountry: '한국' }).countryMix, { 한국: 100 });
  assert.deepEqual(classifyEtf('ACE 미국30년국채액티브', { assetType: '채권', fallbackCountry: '한국' }).countryMix, { 미국: 100 });
  assert.equal(classifyEtf('TIGER 테슬라채권혼합Fn').countryMix, null);
});

test('ETF 섹터: 테마 이름이면 그 섹터 100%, 시장 지수면 대략적인 업종 비율, 모르면 null', () => {
  assert.deepEqual(classifyEtf('KODEX 반도체').sectorMix, { 기술: 100 });
  assert.deepEqual(classifyEtf('TIGER 200 IT').sectorMix, { 기술: 100 });
  assert.deepEqual(classifyEtf('TIGER 200 중공업').sectorMix, { 산업재: 100 });
  assert.deepEqual(classifyEtf('TIGER 2차전지테마').sectorMix, { 산업재: 100 });
  assert.deepEqual(classifyEtf('KODEX 국고채3년').sectorMix, { 채권: 100 });
  assert.deepEqual(classifyEtf('TIGER CD금리투자KIS(합성)').sectorMix, { 현금성: 100 });
  assert.deepEqual(classifyEtf('KODEX 200선물인버스2X').sectorMix, { 기타: 100 });
  const kospi = classifyEtf('KODEX 200', { market: '국내' });
  assert.deepEqual(kospi.sectorMix, APPROX_SECTOR_MIXES.kospi200);
  assert.equal(kospi.approx, true);
  assert.deepEqual(classifyEtf('TIGER 미국S&P500').sectorMix, APPROX_SECTOR_MIXES.sp500);
  assert.deepEqual(classifyEtf('KODEX 미국나스닥100TR').sectorMix, APPROX_SECTOR_MIXES.nasdaq100);
  assert.deepEqual(classifyEtf('TIGER 미국배당다우존스').sectorMix, APPROX_SECTOR_MIXES.usDividend);
  assert.equal(classifyEtf('KODEX 레버리지').sectorMix, null);
  assert.equal(classifyEtf('KODEX 반도체').approx, false);
});

test('ETF 분산 정도는 이름으로 짐작한 값 (시장 전체형·업종·테마형·집중형)', () => {
  assert.equal(classifyEtf('KODEX 200').spread, 'market');
  assert.equal(classifyEtf('KODEX 반도체').spread, 'theme');
  assert.equal(classifyEtf('KODEX 레버리지').spread, 'single');
});

test('국내 시장지수 분류(broadIndex): 이름에 코스피가 없어도 시장 전체형, 업종은 코스피200 대략값', () => {
  const korea = classifyEtf('TIGER MSCI Korea TR', { market: '국내', broadIndex: true });
  assert.equal(korea.spread, 'market');
  assert.deepEqual(korea.sectorMix, APPROX_SECTOR_MIXES.kospi200);
  assert.equal(korea.approx, true);
  assert.equal(classifyEtf('TIGER MSCI Korea TR').sectorMix, null);
  // 레버리지는 시장 지수여도 집중형, 업종은 코스피200 대략값
  const leverage = classifyEtf('KODEX 레버리지', { market: '국내', broadIndex: true });
  assert.equal(leverage.spread, 'single');
  assert.deepEqual(leverage.sectorMix, APPROX_SECTOR_MIXES.kospi200);
  // 커버드콜은 배당주, 기초가 코스피200이면 시장 전체형
  const coveredCall = classifyEtf('TIGER 200커버드콜', { market: '국내', broadIndex: true });
  assert.equal(coveredCall.assetClass, '배당주');
  assert.equal(coveredCall.spread, 'market');
  // 테마 이름이 있으면 그 업종
  assert.deepEqual(classifyEtf('TIGER 반도체TOP10레버리지', { market: '국내', broadIndex: true }).sectorMix, { 기술: 100 });
});
