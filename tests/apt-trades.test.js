// 시트 코드(Code.gs)의 아파트 실거래가 조회를 가짜 공공데이터 응답으로 실행해 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeSheet, load } from './helpers/apps-script-harness.js';

const HEADER = ['티커', '가격', '통화'];
const sheets = () => [new FakeSheet('시세', 1, [HEADER])];

const item = (fields) => `<item>${Object.entries(fields).map(([key, value]) => `<${key}>${value}</${key}>`).join('')}</item>`;
const xml = (items, total = items.length) => `<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body><items>${items.join('')}</items><numOfRows>1000</numOfRows><pageNo>1</pageNo><totalCount>${total}</totalCount></body></response>`;
const trade = (overrides) => item({
  aptSeq: '11680-123', aptNm: '래미안&amp;퍼스티지', umdNm: '반포동', excluUseAr: '84.97', dealAmount: ' 350,000', dealYear: '2026',
  dealMonth: '10', dealDay: '5', floor: '12', cdealType: ' ', jibun: '20-1', ...overrides,
});

// DEAL_YMD에 따라 다른 거래를 돌려주는 가짜 공공데이터
function fakeMolit(byMonth, { endpointError = null } = {}) {
  return (url) => {
    const ym = /DEAL_YMD=(\d{6})/.exec(url)?.[1];
    if (endpointError && url.includes(endpointError.endpoint)) return { status: 200, body: endpointError.body };
    return { status: 200, body: xml(byMonth[ym] ?? []) };
  };
}
const run = (context, params) => JSON.parse(context.doGet({ parameter: params }).text);
const now = new Date();
const ym = (offset) => {
  const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
  return { ym: `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`, year: String(date.getFullYear()), month: String(date.getMonth() + 1) };
};

test('인증키가 없으면 no-key, 시세 응답에는 인증키가 있는지만 알린다', () => {
  const { context } = load(sheets());
  assert.deepEqual(run(context, { action: 'apt-price', lawd: '11680', apt: 'x', area: '84' }).aptError, 'no-key');
  assert.equal(run(context, {}).aptKey, false);
  assert.ok(run(context, {}).features.includes('apt-trades'));
  const withKey = load(sheets(), { properties: { MOLIT_API_KEY: 'abc' } }).context;
  const quotes = run(withKey, {});
  assert.equal(quotes.aptKey, true);
  assert.ok(!JSON.stringify(quotes).includes('abc'), '인증키 자체는 보내지 않음');
});

test('단지 목록: 최근 12개월 거래를 단지·전용면적별로 모으고 해제된 거래는 뺀다', () => {
  const m0 = ym(0);
  const m3 = ym(3);
  const { context, calls } = load(sheets(), {
    properties: { MOLIT_API_KEY: 'a%2Bb' },
    fetch: fakeMolit({
      [m0.ym]: [trade({}), trade({ excluUseAr: '59.99', dealAmount: '250,000' }), trade({ aptSeq: '11680-9', aptNm: '아크로리버', umdNm: '반포동' })],
      [m3.ym]: [trade({ cdealType: 'O' }), trade({ aptSeq: '11680-9', aptNm: '아크로리버', umdNm: '반포동', excluUseAr: '84.95' })],
    }),
  });
  const result = run(context, { action: 'apt-complexes', lawd: '11680' });
  assert.equal(calls.fetches.length, 12, '12개월을 한꺼번에');
  assert.ok(calls.fetches.every((url) => url.includes('serviceKey=a%2Bb') && url.includes('LAWD_CD=11680') && url.includes('RTMSDataSvcAptTradeDev')), 'Encoding 키도 한 번 풀어 다시 인코딩');
  assert.deepEqual(result.complexes.map((c) => [c.name, c.count]), [['래미안&퍼스티지', 2], ['아크로리버', 2]]);
  assert.deepEqual(result.complexes[0].areas, [{ area: 59.99, count: 1 }, { area: 84.97, count: 1 }]);
  // 두 번째 부르면 캐시를 쓴다
  run(context, { action: 'apt-complexes', lawd: '11680' });
  assert.equal(calls.fetches.length, 12);
});

test('집값: 같은 단지·전용면적(±1㎡) 거래로 최근 3개월 → 6개월 → 12개월 평균, 해제 거래는 뺀다', () => {
  const months = [0, 1, 4, 8].map(ym);
  const deal = (m, amount, extra = {}) => trade({ dealYear: m.year, dealMonth: m.month, dealAmount: amount, ...extra });
  const { context } = load(sheets(), {
    properties: { MOLIT_API_KEY: 'k' },
    fetch: fakeMolit({
      [months[0].ym]: [deal(months[0], '350,000'), deal(months[0], '999,000', { cdealType: 'O' }), deal(months[0], '200,000', { excluUseAr: '59.99' })],
      [months[1].ym]: [deal(months[1], '340,000', { excluUseAr: '84.10' })],
      [months[2].ym]: [deal(months[2], '320,000')],
      [months[3].ym]: [deal(months[3], '300,000')],
    }),
  });
  const result = run(context, { action: 'apt-price', lawd: '11680', apt: '11680-123', name: '래미안&퍼스티지', dong: '반포동', area: '84.97' });
  assert.deepEqual(result.windows.map((w) => [w.months, w.count, w.average]), [[3, 2, 3_450_000_000], [6, 3, 3_366_666_667], [12, 4, 3_275_000_000]]);
  assert.equal(result.used.months, 3);
  assert.equal(result.used.from, ym(2).ym);
  assert.equal(result.used.to, ym(0).ym);
  assert.equal(result.trades[0].amount, 3_500_000_000);
  assert.equal(result.trades.length, 4);

  // 최근 3개월에 거래가 없으면 6개월, 1년에 하나도 없으면 used: null
  const older = load(sheets(), { properties: { MOLIT_API_KEY: 'k' }, fetch: fakeMolit({ [months[2].ym]: [deal(months[2], '320,000')] }) }).context;
  assert.equal(run(older, { action: 'apt-price', lawd: '11680', apt: '11680-123', area: '84.97' }).used.months, 6);
  const none = load(sheets(), { properties: { MOLIT_API_KEY: 'k' }, fetch: fakeMolit({}) }).context;
  assert.equal(run(none, { action: 'apt-price', lawd: '11680', apt: '11680-123', area: '84.97' }).used, null);
});

test('상세 자료를 쓸 수 없는 키면 기본 자료로 받고(단지명·법정동으로 맞춤), 다음부터 기본 자료를 먼저 쓴다', () => {
  const m0 = ym(0);
  const denied = '<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_ACCESS_DENIED_ERROR</returnAuthMsg><returnReasonCode>20</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>';
  const { context, properties } = load(sheets(), {
    properties: { MOLIT_API_KEY: 'k' },
    fetch: fakeMolit({ [m0.ym]: [trade({ aptSeq: '', dealYear: m0.year, dealMonth: m0.month })] }, { endpointError: { endpoint: 'AptTradeDev', body: denied } }),
  });
  const result = run(context, { action: 'apt-price', lawd: '11680', apt: '11680-123', name: '래미안&퍼스티지', dong: '반포동', area: '84.97' });
  assert.equal(result.used.count, 1);
  assert.equal(properties.MOLIT_ENDPOINT, '1');
});

test('공공데이터 오류: 키 틀림·만료·사용량 초과를 코드로 알리고, 잘못된 요청은 bad-request', () => {
  const answer = (body, status = 200) => load(sheets(), { properties: { MOLIT_API_KEY: 'k' }, fetch: () => ({ status, body }) }).context;
  const header = (code, auth) => `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>${auth}</returnAuthMsg><returnReasonCode>${code}</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;
  const params = { action: 'apt-complexes', lawd: '11680' };
  assert.equal(run(answer(header(30, 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR')), params).aptError, 'key');
  assert.equal(run(answer(header(31, 'DEADLINE_HAS_EXPIRED_ERROR')), params).aptError, 'expired');
  assert.equal(run(answer(header(22, 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR')), params).aptError, 'limit');
  assert.equal(run(answer('Unauthorized', 401), params).aptError, 'key');
  assert.equal(run(answer(xml([])), { action: 'apt-complexes', lawd: '1168' }).aptError, 'bad-request');
});

test('구글 오류 문구에 요청 주소가 섞여도 인증키는 앱으로 보내지 않는다', () => {
  const { context } = load(sheets(), {
    properties: { MOLIT_API_KEY: 'SECRET123' },
    fetch: (url) => { throw new Error(`Address unavailable: ${url}`); },
  });
  const result = run(context, { action: 'apt-complexes', lawd: '11680' });
  const text = JSON.stringify(result);
  assert.ok(!text.includes('SECRET123'), text);
  assert.match(text, /Address unavailable: https:\/\/apis\.data\.go\.kr\/\S+\?…/);
});

test('checkRealEstateKey: 편집기에서 실행하면 인증키가 되는지 알려 준다', () => {
  const ok = load(sheets(), { properties: { MOLIT_API_KEY: 'k' }, fetch: () => ({ status: 200, body: xml([trade({})]) }) });
  ok.context.checkRealEstateKey();
  assert.match(ok.calls.logs[0], /인증키가 잘 동작해요/);
  const missing = load(sheets());
  missing.context.checkRealEstateKey();
  assert.match(missing.calls.logs[0], /MOLIT_API_KEY가 없어요/);
});
