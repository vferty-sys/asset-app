// 종목 목록 검색: 코드·이름·한글 별칭으로 찾고, 정확히 같은 것 → 앞부분이 같은 것 → 들어 있는 것 순서
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countryFixes, expandItem, findByTicker, normalizeQuery, searchStocks } from '../js/stock-list.js';

const ITEMS = [
  { t: 'KRX:005930', n: '삼성전자', k: 's', c: 'KRW', co: '한국', se: '기술', a: '성장주', g: 'kr' },
  { t: 'KRX:005935', n: '삼성전자우', k: 's', c: 'KRW', co: '한국', se: '기술', a: '성장주', g: 'kr' },
  { t: 'KRX:006400', n: '삼성SDI', k: 's', c: 'KRW', co: '한국', se: '산업재', a: '성장주', g: 'kr' },
  { t: 'KRX:069500', n: 'KODEX 200', k: 'e', c: 'KRW', co: '한국', se: { 기술: 45, 금융: 55 }, a: '성장주', sp: 'market', ax: 1, g: 'kr-etf' },
  { t: 'NASDAQ:AAPL', n: 'Apple Inc.', al: ['애플'], k: 's', c: 'USD', co: '미국', se: '기술', a: '성장주', g: 'us' },
  { t: 'NYSEARCA:SPY', n: 'SPDR S&P 500 ETF Trust', al: ['스파이'], k: 'e', c: 'USD', co: '미국', se: null, a: '성장주', sp: 'market', g: 'us-etf' },
].map(expandItem);

const names = (results) => results.map((item) => item.name);

test('파일의 짧은 이름표를 화면용으로 풀어 쓴다 (비율 하나는 100%로)', () => {
  const etf = ITEMS[3];
  assert.equal(etf.type, 'etf');
  assert.deepEqual(etf.countryMix, { 한국: 100 });
  assert.deepEqual(etf.sectorMix, { 기술: 45, 금융: 55 });
  assert.equal(etf.etfSpread, 'market');
  assert.equal(etf.approx, true);
  assert.equal(ITEMS[0].etfSpread, null);
  assert.equal(ITEMS[5].sectorMix, null);
});

test('검색어 정리: 소문자, 띄어쓰기·기호 빼기', () => {
  assert.equal(normalizeQuery(' S&P 500 '), 'sp500');
  assert.equal(normalizeQuery('KODEX 200'), 'kodex200');
});

test('이름으로 찾기: 정확히 같은 이름이 먼저, 그다음 앞부분이 같은 이름 (짧은 이름 먼저)', () => {
  assert.deepEqual(names(searchStocks(ITEMS, '삼성전자')), ['삼성전자', '삼성전자우']);
  assert.deepEqual(names(searchStocks(ITEMS, '삼성')), ['삼성전자', '삼성SDI', '삼성전자우']);
  assert.deepEqual(names(searchStocks(ITEMS, 'kodex 200')), ['KODEX 200']);
});

test('점수가 같으면 시가총액 자릿수(sz)가 큰 종목 먼저', () => {
  const items = [
    { t: 'KRX:006660', n: '삼성공조', k: 's', c: 'KRW', co: '한국', se: '소비재', a: '성장주', sz: 2, g: 'kr' },
    { t: 'KRX:005930', n: '삼성전자', k: 's', c: 'KRW', co: '한국', se: '기술', a: '성장주', sz: 7, g: 'kr' },
    { t: 'KRX:028260', n: '삼성물산', k: 's', c: 'KRW', co: '한국', se: '산업재', a: '성장주', sz: 5, g: 'kr' },
  ].map(expandItem);
  assert.deepEqual(names(searchStocks(items, '삼성')), ['삼성전자', '삼성물산', '삼성공조']);
  // 점수가 다르면 점수 먼저 (정확히 같은 이름이 덩치보다 앞)
  assert.deepEqual(names(searchStocks(items, '삼성공조')), ['삼성공조']);
  assert.equal(ITEMS[0].size, 0);
});

test('코드·한글 별칭으로도 찾는다', () => {
  assert.deepEqual(names(searchStocks(ITEMS, '005930')), ['삼성전자']);
  assert.deepEqual(names(searchStocks(ITEMS, 'aapl')), ['Apple Inc.']);
  assert.deepEqual(names(searchStocks(ITEMS, '애플')), ['Apple Inc.']);
  assert.deepEqual(names(searchStocks(ITEMS, 's&p')), ['SPDR S&P 500 ETF Trust']);
  assert.deepEqual(searchStocks(ITEMS, '  '), []);
  assert.deepEqual(searchStocks(ITEMS, '없는종목'), []);
  assert.equal(searchStocks(ITEMS, '삼', { limit: 2 }).length, 2);
});

test('티커로 찾기: 거래소를 붙여도, 빼도', () => {
  assert.equal(findByTicker(ITEMS, 'KRX:005930').name, '삼성전자');
  assert.equal(findByTicker(ITEMS, '005930').name, '삼성전자');
  assert.equal(findByTicker(ITEMS, 'aapl').name, 'Apple Inc.');
  assert.equal(findByTicker(ITEMS, 'KOSDAQ:005930'), null);
  assert.equal(findByTicker(ITEMS, ''), null);
});

test('다국가 지수 ETF는 국가 비중표 항목(cp)을 함께 풀어 쓴다', () => {
  const [world] = [{ t: 'KRX:251350', n: 'KODEX 선진국MSCI World', k: 'e', c: 'KRW', co: { 미국: 72, 기타: 28 }, cp: 'MSCI World', a: '성장주', sp: 'market', g: 'kr-etf' }].map(expandItem);
  assert.equal(world.countryPreset, 'MSCI World');
  assert.equal(ITEMS[3].countryPreset, null);
});

test('국가가 "한국"으로 저장된 해외 투자 ETF 찾기 (목록 값, 없으면 이름으로 짐작)', () => {
  const items = [
    { t: 'KRX:360750', n: 'TIGER 미국S&P500', k: 'e', c: 'KRW', co: '미국', a: '성장주', sp: 'market', g: 'kr-etf' },
    { t: 'KRX:251350', n: 'KODEX 선진국MSCI World', k: 'e', c: 'KRW', co: { 미국: 72, 기타: 28 }, cp: 'MSCI World', a: '성장주', sp: 'market', g: 'kr-etf' },
    { t: 'KRX:069500', n: 'KODEX 200', k: 'e', c: 'KRW', co: '한국', a: '성장주', sp: 'market', g: 'kr-etf' },
  ].map(expandItem);
  const etf = (id, name, ticker, overrides = {}) => ({ id, name, ticker, type: 'etf', account: '연금저축', countryMix: { 한국: 100 }, countryPreset: null, ...overrides });
  const holdings = [
    etf('a', 'TIGER 미국S&P500', 'KRX:360750'),
    etf('b', 'KODEX 선진국MSCI World', 'KRX:251350'),
    etf('c', 'KODEX 200', 'KRX:069500'), // 정말 한국 → 그대로
    etf('d', 'ACE 미국나스닥100', 'KRX:367380'), // 목록에 없음 → 이름으로 미국
    etf('e', 'KODEX 반도체', 'KRX:091160'), // 목록에 없고 이름에 단서 없음 → 건드리지 않음
    etf('f', 'TIGER 미국S&P500', 'KRX:360750', { countryMix: { 미국: 100 } }), // 이미 맞음
    { ...etf('g', '삼성전자', 'KRX:005930'), type: 'stock' }, // 개별 주식은 본사 나라
  ];
  const fixes = countryFixes(holdings, items);
  assert.deepEqual(fixes.map((fix) => [fix.holding.id, fix.countryPreset, fix.countryMix]), [
    ['a', null, { 미국: 100 }],
    ['b', 'MSCI World', { 미국: 72, 기타: 28 }],
    ['d', null, { 미국: 100 }],
  ]);
  // 종목 목록을 받지 못해도 이름으로 짐작해서 찾는다
  assert.deepEqual(countryFixes(holdings, []).map((fix) => fix.holding.id), ['a', 'b', 'd']);
});

test('짐작한 값 표시(gc·gs)를 풀어 쓰고, 검색용 이름을 미리 정리해 둔다', () => {
  const item = expandItem({ t: 'NYSE:ZZZ', n: 'Zeta Corp', al: ['제타'], k: 's', c: 'USD', co: '미국', se: '기타', a: '성장주', gc: 1, gs: 1, g: 'us' });
  assert.deepEqual(item.guessed, { country: true, sector: true });
  assert.deepEqual(item.searchNames, ['zetacorp', '제타']);
  assert.equal(item.searchCode, 'zzz');
  assert.deepEqual(expandItem({ t: 'KRX:005930', n: '삼성전자', k: 's', c: 'KRW' }).guessed, { country: false, sector: false });
});

test('실제 목록: 한글 별칭·영어 이름·티커로 S&P500 밖 미국 주식도 찾고, 같은 점수면 큰 회사 먼저', async () => {
  const { readFileSync } = await import('node:fs');
  const items = JSON.parse(readFileSync(new URL('../data/stocks.json', import.meta.url), 'utf8')).items.map(expandItem);
  assert.equal(searchStocks(items, '페트로브라스')[0]?.ticker, 'NYSE:PBR');
  assert.equal(searchStocks(items, '애버크롬비')[0]?.ticker, 'NYSE:ANF');
  assert.ok(searchStocks(items, 'petrobras').some((item) => item.ticker === 'NYSE:PBR'));
  assert.equal(searchStocks(items, 'ANF')[0]?.ticker, 'NYSE:ANF');
  assert.equal(searchStocks(items, 'apple')[0]?.ticker, 'NASDAQ:AAPL', '애플이 Apple Hospitality보다 먼저');
  assert.equal(searchStocks(items, '삼성전자')[0]?.ticker, 'KRX:005930');
  assert.equal(searchStocks(items, 'BRK.B')[0]?.ticker, 'NYSE:BRK.B', '점이 든 티커');
  assert.equal(searchStocks(items, 'brkb')[0]?.ticker, 'NYSE:BRK.B');
});
