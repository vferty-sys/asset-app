// 종목 목록 검색: 코드·이름·한글 별칭으로 찾고, 정확히 같은 것 → 앞부분이 같은 것 → 들어 있는 것 순서
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandItem, findByTicker, normalizeQuery, searchStocks } from '../js/stock-list.js';

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
