// 시트 코드(Code.gs)의 작년 배당금 조회를 가짜 야후 파이낸스 응답으로 실행해 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeSheet, load } from './helpers/apps-script-harness.js';

const sheets = () => [new FakeSheet('시세', 1, [['티커', '가격', '통화']])];
const run = (context, params) => JSON.parse(context.doGet({ parameter: params }).text);
const YEAR = new Date().getFullYear() - 1;
const at = (year, month, day) => Math.floor(Date.UTC(year, month - 1, day) / 1000);

// 야후 차트 응답 모양: chart.result[0].meta.currency, events.dividends[시각] = { amount, date }
const chart = (currency, events) => JSON.stringify({
  chart: {
    result: [{
      meta: { currency },
      events: { dividends: Object.fromEntries(events.map(([date, amount]) => [String(date), { amount, date }])) },
    }],
    error: null,
  },
});
const NOT_FOUND = JSON.stringify({ chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } });

// 심볼별 응답. 함수면 (url) => { status, body }
function fakeYahoo(bySymbol) {
  return (url) => {
    const symbol = decodeURIComponent(/\/chart\/([^?]+)/.exec(url)[1]);
    const answer = bySymbol[symbol];
    if (typeof answer === 'function') return answer(url);
    return answer ?? { status: 404, body: NOT_FOUND };
  };
}

const SCHD = chart('USD', [
  [at(YEAR - 1, 12, 11), 0.7], // 재작년: 빼야 함
  [at(YEAR, 3, 26), 0.25], [at(YEAR, 6, 25), 0.26], [at(YEAR, 9, 24), 0.26], [at(YEAR, 12, 10), 0.27],
  [at(YEAR + 1, 3, 25), 0.3], // 올해: 빼야 함
]);
const SAMSUNG = chart('KRW', [[at(YEAR, 3, 28), 361], [at(YEAR, 6, 27), 361], [at(YEAR, 9, 26), 361], [at(YEAR, 12, 26), 361]]);

test('티커 → 야후 심볼: 국내는 .KS/.KQ, 미국은 점을 줄표로, 다른 거래소는 지원 안 함', () => {
  const { context } = load(sheets());
  assert.equal(context.yahooSymbol_('KRX:005930'), '005930.KS');
  assert.equal(context.yahooSymbol_('KRX:0085P0'), '0085P0.KS');
  assert.equal(context.yahooSymbol_('KOSDAQ:247540'), '247540.KQ');
  assert.equal(context.yahooSymbol_('NASDAQ:QQQ'), 'QQQ');
  assert.equal(context.yahooSymbol_('NYSE:BRK.B'), 'BRK-B');
  assert.equal(context.yahooSymbol_('NYSEARCA:SCHD'), 'SCHD');
  assert.equal(context.yahooSymbol_('TYO:7203'), null);
  assert.equal(context.yahooSymbol_('CURRENCY:USDKRW'), null);
  assert.equal(context.yahooSymbol_('005930'), null);
});

test('작년(1~12월) 배당만 더하고, 통화와 횟수를 함께 돌려준다', () => {
  const { context, calls } = load(sheets(), { fetch: fakeYahoo({ SCHD: { status: 200, body: SCHD }, '005930.KS': { status: 200, body: SAMSUNG } }) });
  const result = run(context, { action: 'dividends', tickers: 'NYSEARCA:SCHD,KRX:005930,TYO:7203,nyse:none' });
  assert.equal(result.year, YEAR);
  assert.deepEqual(result.dividends['NYSEARCA:SCHD'], { perShare: 1.04, count: 4, currency: 'USD' });
  assert.deepEqual(result.dividends['KRX:005930'], { perShare: 1444, count: 4, currency: 'KRW' });
  assert.deepEqual(result.unsupported, ['TYO:7203']);
  assert.deepEqual(result.failed, ['NYSE:NONE'], '야후에 없는 종목');
  assert.ok(calls.fetches.every((url) => url.includes('events=div') && url.includes('interval=1mo')));
  assert.ok(run(context, {}).features.includes('dividends'), '앱이 배당금 기능이 있는 코드인지 알 수 있게');
});

test('받은 값은 저장해 두고 다시 묻지 않는다 (3월까지는 일주일마다 새로), 실패한 티커는 6시간 동안 다시 묻지 않는다', () => {
  const { context, calls, properties } = load(sheets(), { fetch: fakeYahoo({ SCHD: { status: 200, body: SCHD } }) });
  const params = { tickers: 'NYSEARCA:SCHD,NASDAQ:GONE' };
  const may = new Date(YEAR + 1, 4, 10);
  context.dividends_(params, may);
  assert.equal(calls.fetches.length, 2);
  assert.ok(properties[`div:${YEAR}:NYSEARCA:SCHD`], '스크립트 속성에 저장');
  const again = context.dividends_(params, new Date(YEAR + 1, 9, 1));
  assert.equal(calls.fetches.length, 2, '4월 이후에는 저장한 값을 그대로');
  assert.equal(again.dividends['NYSEARCA:SCHD'].perShare, 1.04);
  assert.deepEqual([...again.failed], ['NASDAQ:GONE'], '실패한 티커는 잠시 묻지 않음');

  // 2월: 국내 결산 배당이 늦게 정해질 수 있어 일주일이 지나면 새로 받는다
  const early = load(sheets(), { fetch: fakeYahoo({ SCHD: { status: 200, body: SCHD } }) });
  early.context.dividends_({ tickers: 'NYSEARCA:SCHD' }, new Date(YEAR + 1, 1, 1));
  early.context.dividends_({ tickers: 'NYSEARCA:SCHD' }, new Date(YEAR + 1, 1, 3));
  assert.equal(early.calls.fetches.length, 1, '일주일 안');
  early.context.dividends_({ tickers: 'NYSEARCA:SCHD' }, new Date(YEAR + 1, 1, 10));
  assert.equal(early.calls.fetches.length, 2, '일주일 지나면 새로');
});

test('첫 주소가 거절하면(429) 다른 주소로 한 번 더 묻고, 둘 다 안 되면 failed', () => {
  let first = 0;
  const flaky = (url) => {
    if (url.startsWith('https://query1.')) { first += 1; return { status: 429, body: 'Too Many Requests' }; }
    return { status: 200, body: SCHD };
  };
  const { context, calls } = load(sheets(), { fetch: fakeYahoo({ SCHD: flaky, DOWN: { status: 503, body: '' } }) });
  const result = run(context, { action: 'dividends', tickers: 'NYSEARCA:SCHD,NYSE:DOWN' });
  assert.equal(first, 1);
  assert.equal(result.dividends['NYSEARCA:SCHD'].perShare, 1.04);
  assert.deepEqual(result.failed, ['NYSE:DOWN']);
  assert.equal(calls.fetches.length, 4);
});

test('배당이 없었던 종목은 0, 많이 보내도 40개까지만, 몇 개씩 나눠 묻는다', () => {
  const answers = {};
  const tickers = [];
  for (let i = 0; i < 45; i += 1) {
    answers[`T${i}`] = { status: 200, body: chart('USD', []) };
    tickers.push(`NASDAQ:T${i}`);
  }
  const { context, calls } = load(sheets(), { fetch: fakeYahoo(answers) });
  const result = run(context, { action: 'dividends', tickers: tickers.join(',') });
  assert.equal(Object.keys(result.dividends).length, 40);
  assert.deepEqual(result.dividends['NASDAQ:T0'], { perShare: 0, count: 0, currency: 'USD' });
  assert.equal(calls.sleep.length, 4, '8개씩 5번 → 사이에 4번 쉼');
});

test('checkDividends: 편집기에서 실행하면 실행 로그에 작년 배당금을 적는다', () => {
  const { context, calls } = load(sheets(), { fetch: fakeYahoo({ SCHD: { status: 200, body: SCHD }, '005930.KS': { status: 200, body: SAMSUNG } }) });
  context.checkDividends();
  assert.equal(calls.scopeChecks, 1, '빠진 권한이 있으면 다시 물어봄');
  assert.match(calls.logs.at(-1), new RegExp(`작년\\(${YEAR}년\\) 배당금을 잘 받았어요.*SCHD 주당 1\\.04 USD \\(4번\\).*005930 주당 1444 KRW`));
});
