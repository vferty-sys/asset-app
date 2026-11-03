import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AptError, aptLabel, areaText, fetchAptComplexes, fetchAptPrice, marketFromResponse } from '../js/apt-price.js';
import { normalizeRealEstate, realEstateTotal, realEstateValue, validateRealEstate } from '../js/real-estate.js';
import { FakeSheet, fakeWebAppFetch, load } from './helpers/apps-script-harness.js';

const SHEET = 'https://script.google.com/macros/s/abc/exec';
const respond = (body) => async () => new Response(JSON.stringify(body));
const auto = { lawd: '11680', district: '서울특별시 강남구', apt: '11680-1', name: '래미안', dong: '대치동', area: 84.97 };

test('표시: 최근 몇 개월 몇 건 평균과 기간, 전용면적과 평', () => {
  assert.equal(aptLabel({ average: 1, months: 3, count: 4, from: '202609', to: '202611' }), '최근 3개월 거래 4건 평균 (2026년 9월~11월)');
  assert.equal(aptLabel({ average: 1, months: 12, count: 1, from: '202512', to: '202611' }), '최근 12개월 거래 1건 평균 (2025년 12월~2026년 11월)');
  assert.equal(aptLabel({ average: null }), '');
  // 평형은 흔히 부르는 공급면적 기준 (전용 84㎡ ≈ 34평형, 59㎡ ≈ 24평형)
  assert.equal(areaText(84.97), '84.97㎡ (약 34평형)');
  assert.equal(areaText(59.99), '59.99㎡ (약 24평형)');
  assert.equal(areaText(114.9), '114.90㎡ (약 46평형)');
  assert.equal(areaText(0), '');
});

test('시트 코드 응답 → 저장할 market (거래가 없으면 평균 없음)', () => {
  const now = new Date('2026-11-03T00:00:00Z');
  const market = marketFromResponse({ used: { months: 6, count: 2, average: 812_500_000.4, min: 800_000_000, max: 825_000_000, from: '202606', to: '202611' }, trades: [{ date: '2026-10-05', amount: 825_000_000, floor: 12, area: 84.97 }] }, now);
  assert.deepEqual({ ...market, trades: market.trades.length }, { average: 812_500_000, months: 6, count: 2, min: 800_000_000, max: 825_000_000, from: '202606', to: '202611', trades: 1, fetchedAt: now.toISOString() });
  assert.equal(marketFromResponse({ used: null, trades: [] }, now).average, null);
});

test('오류: 인증키 없음·만료·예전 시트 코드·시트 미연결을 알아보기 쉬운 문구로', async () => {
  await assert.rejects(fetchAptPrice(SHEET, auto, { fetchImpl: respond({ aptError: 'no-key' }) }), (error) => error instanceof AptError && error.code === 'no-key' && /인증키/.test(error.message));
  await assert.rejects(fetchAptPrice(SHEET, auto, { fetchImpl: respond({ aptError: 'expired' }) }), (error) => error.code === 'expired' && /연장/.test(error.message));
  await assert.rejects(fetchAptComplexes(SHEET, '11680', { fetchImpl: respond({ prices: {}, fx: {} }) }), (error) => error.code === 'no-feature');
  await assert.rejects(fetchAptComplexes('', '11680'), (error) => error.code === 'no-sheet');
  await assert.rejects(fetchAptComplexes(SHEET, '11680', { fetchImpl: async () => { throw new TypeError('x'); } }), (error) => error.code === 'network');
  // 원인을 찾을 수 있게 시트 코드가 알려 준 이유를 함께 보여 준다
  await assert.rejects(fetchAptComplexes(SHEET, '11680', { fetchImpl: respond({ aptError: 'api', message: 'NO_OPENAPI_SERVICE_ERROR' }) }),
    (error) => error.code === 'api' && error.message.includes('(이유: NO_OPENAPI_SERVICE_ERROR)'));
  // 시트 코드에 바깥 연결 권한이 없으면 영어 오류 대신 고치는 방법을 안내한다
  const denied = 'UrlFetchApp.fetchAll을(를) 호출할 수 있는 권한이 없습니다. 필요한 권한은 https://www.googleapis.com/auth/script.external_request입니다.';
  await assert.rejects(fetchAptComplexes(SHEET, '11680', { fetchImpl: respond({ error: denied }) }),
    (error) => error.code === 'permission' && /checkRealEstateKey/.test(error.message) && !error.message.includes('이유:'));
  // 구글 오류 문구에 요청 주소가 섞여 와도 인증키는 화면에 나오지 않는다
  const leaky = 'Exception: Address unavailable: https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=SECRET123%2Babc&LAWD_CD=11680';
  await assert.rejects(fetchAptComplexes(SHEET, '11680', { fetchImpl: respond({ error: leaky }) }),
    (error) => !error.message.includes('SECRET123') && error.message.includes('Address unavailable'));
  await assert.rejects(fetchAptComplexes(SHEET, '11680', { fetchImpl: respond({ aptError: 'api', message: 'bad serviceKey=SECRET123 given' }) }),
    (error) => !error.message.includes('SECRET123'));
  await assert.rejects(fetchAptPrice(SHEET, auto, { fetchImpl: respond({ aptError: 'no-key', message: '스크립트 속성에 없음' }) }),
    (error) => !error.message.includes('이유:'), '인증키 없음은 안내 문구만');
});

test('앱 → 시트 코드 → (가짜) 공공데이터: 단지 목록과 평균을 받아 온다', async () => {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const item = (amount) => `<item><aptSeq>11680-1</aptSeq><aptNm>래미안</aptNm><umdNm>대치동</umdNm><excluUseAr>84.97</excluUseAr><dealAmount>${amount}</dealAmount><dealYear>${now.getFullYear()}</dealYear><dealMonth>${now.getMonth() + 1}</dealMonth><dealDay>3</dealDay><floor>7</floor><cdealType> </cdealType></item>`;
  const xml = (items) => `<response><header><resultCode>000</resultCode></header><body><items>${items}</items><totalCount>2</totalCount></body></response>`;
  const { context, calls } = load([new FakeSheet('시세', 1, [['티커', '가격', '통화']])], {
    properties: { MOLIT_API_KEY: 'k' },
    fetch: (url) => ({ status: 200, body: xml(url.includes(`DEAL_YMD=${ym}`) ? item('80,000') + item('85,000') : '') }),
  });
  const fetchImpl = fakeWebAppFetch(context);
  const complexes = await fetchAptComplexes(SHEET, '11680', { fetchImpl });
  assert.deepEqual(complexes.map((c) => [c.name, c.count, c.areas[0].area]), [['래미안', 2, 84.97]]);
  const market = await fetchAptPrice(SHEET, auto, { fetchImpl });
  assert.equal(market.average, 825_000_000);
  assert.equal(market.months, 3);
  assert.equal(market.count, 2);
  assert.ok(calls.fetches.every((url) => !url.includes('11680-1')), '단지 번호는 공공데이터로 보내지 않고 시트 코드가 거른다');
});

test('부동산: 실거래가 평균이 있으면 그 값, 없으면 직접 적은 값 (자동 계산을 끈 집은 직접 적은 값)', () => {
  const market = { average: 820_000_000, months: 3, count: 4, from: '202609', to: '202611', trades: [], fetchedAt: '2026-11-03T00:00:00.000Z' };
  const house = normalizeRealEstate({ name: '우리 집', kind: '아파트', value: 700_000_000, auto, market });
  assert.equal(realEstateValue(house), 820_000_000);
  assert.equal(realEstateValue({ ...house, market: { ...market, average: null } }), 700_000_000);
  assert.equal(realEstateValue(normalizeRealEstate({ value: 500_000_000, market })), 500_000_000, 'auto가 없으면 market도 버림');
  assert.equal(realEstateTotal([house, { value: 100 }]), 820_000_100);
  assert.equal(normalizeRealEstate({ auto: { lawd: '123', area: 84 } }).auto, null, '시·군·구 코드는 5자리');
  // 입력 검사: 평균이 있으면 직접 적는 시세는 비워도 되고, 거래가 없으면 시세가 필요
  const ok = validateRealEstate({ name: '우리 집', kind: '아파트', value: '', baseDate: '', auto, market });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.market.average, 820_000_000);
  const noTrades = validateRealEstate({ name: '우리 집', kind: '아파트', value: '', baseDate: '', auto, market: { ...market, average: null } });
  assert.ok(noTrades.errors.value);
  const notFetched = validateRealEstate({ name: '우리 집', kind: '아파트', value: '1', baseDate: '2026-11-03', auto, market: null });
  assert.match(notFetched.errors.auto, /실거래가 받아오기/);
});

test('시·군·구 목록: 5자리 코드, 바뀐 행정구역 반영', () => {
  const data = JSON.parse(readFileSync(new URL('../data/districts.json', import.meta.url), 'utf8'));
  assert.ok(data.count > 200 && data.items.length === data.count);
  const byCode = new Map(data.items.map(([code, sido, name]) => [code, `${sido} ${name}`]));
  assert.ok(data.items.every(([code]) => /^\d{5}$/.test(code)));
  assert.equal(byCode.get('11680'), '서울특별시 강남구');
  assert.equal(byCode.get('41135'), '경기도 성남시 분당구');
});
