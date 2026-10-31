// 종목 자동 분류 규칙: 국내 업종·미국 GICS 섹터 → 앱 섹터, 개별 주식 자산군, ETF 이름·분류로 국가·섹터·자산군·분산 정도
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROX_COUNTRY_MIXES, APPROX_SECTOR_MIXES, classifyEtf, sectorFromGics, sectorFromKrxIndustry, stockAssetClass,
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

test('국내 업종 → 앱 섹터', () => {
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
  for (const [industry, sector] of Object.entries(cases)) assert.equal(sectorFromKrxIndustry(industry), sector, industry);
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
