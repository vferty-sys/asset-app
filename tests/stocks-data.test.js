// 종목 목록 파일(data/stocks.json) 검사: 매달 자동으로 새로 만들 때도 이 검사를 통과해야 저장한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ASSET_CLASSES, COUNTRY_OPTIONS, CURRENCIES, ETF_SPREADS, SECTOR_OPTIONS } from '../js/constants.js';
import { COUNTRY_PRESETS } from '../js/country-weights.js';

const data = JSON.parse(readFileSync(fileURLToPath(new URL('../data/stocks.json', import.meta.url)), 'utf8'));
const TICKER = /^(KRX|KOSDAQ|NASDAQ|NYSE|NYSEARCA|NYSEAMERICAN|BATS):[A-Z0-9.]+$|^[A-Z0-9.]+$/;

function checkMix(value, options, where) {
  if (value == null) return;
  if (typeof value === 'string') {
    assert.ok(options.includes(value), `${where}: ${value}`);
    return;
  }
  const entries = Object.entries(value);
  assert.ok(entries.length > 0, where);
  for (const [name, percent] of entries) {
    assert.ok(options.includes(name), `${where}: ${name}`);
    assert.ok(percent > 0 && percent <= 100, `${where}: ${percent}`);
  }
  assert.equal(entries.reduce((sum, [, percent]) => sum + percent, 0), 100, `${where} 합계`);
}

test('종목 목록: 머리말과 개수', () => {
  assert.equal(data.version, 1);
  assert.ok(Array.isArray(data.items) && data.items.length > 0);
  const counted = Object.values(data.counts).reduce((sum, count) => sum + count, 0);
  assert.equal(counted, data.items.length);
});

test('종목 목록: 모든 종목이 앱에서 쓸 수 있는 값이고 티커가 겹치지 않는다', () => {
  const seen = new Set();
  for (const item of data.items) {
    const where = `${item.t} ${item.n}`;
    assert.match(item.t, TICKER, where);
    assert.ok(!seen.has(item.t), `겹침: ${where}`);
    seen.add(item.t);
    assert.ok(typeof item.n === 'string' && item.n.trim(), where);
    assert.ok(['s', 'e'].includes(item.k), where);
    assert.ok(CURRENCIES.includes(item.c), where);
    assert.ok(ASSET_CLASSES.includes(item.a), where);
    checkMix(item.co, COUNTRY_OPTIONS, `${where} 국가`);
    checkMix(item.se, SECTOR_OPTIONS, `${where} 섹터`);
    if (item.k === 'e') assert.ok(ETF_SPREADS.includes(item.sp), where);
    if (item.k === 's') assert.ok(typeof item.co === 'string' && typeof item.se === 'string', `개별 주식은 국가·섹터 하나: ${where}`);
    if (item.al) assert.ok(Array.isArray(item.al) && item.al.every((alias) => typeof alias === 'string' && alias), where);
    if (item.sz !== undefined) assert.ok(Number.isInteger(item.sz) && item.sz > 0 && item.sz < 10, `시가총액 자릿수: ${where}`);
    if (item.cp !== undefined) assert.ok(item.k === 'e' && COUNTRY_PRESETS.includes(item.cp), `국가 비중표 항목: ${where}`);
  }
});

test('종목 목록: 국내·미국 대표 종목이 들어 있고 분류가 맞다', () => {
  const byTicker = new Map(data.items.map((item) => [item.t, item]));
  const expect = (ticker, fields) => {
    const item = byTicker.get(ticker);
    assert.ok(item, `${ticker} 없음`);
    for (const [key, value] of Object.entries(fields)) assert.deepEqual(item[key], value, `${ticker} ${key}`);
  };
  expect('KRX:005930', { n: '삼성전자', k: 's', c: 'KRW', co: '한국', se: '기술', a: '성장주', g: 'kr' });
  expect('KRX:005935', { n: '삼성전자우', se: '기술' });
  expect('KRX:105560', { se: '금융', a: '배당주' });
  expect('KOSDAQ:196170', { se: '헬스케어', g: 'kr' }); // 알테오젠 (코스닥)
  expect('KRX:069500', { n: 'KODEX 200', k: 'e', co: '한국', sp: 'market', a: '성장주', g: 'kr-etf' });
  expect('KRX:360750', { co: '미국', sp: 'market' }); // TIGER 미국S&P500
  expect('KRX:122630', { sp: 'single' }); // KODEX 레버리지
  // 국내 상장이어도 투자 대상 나라로: 미국 지수는 미국, 다국가 지수는 국가 비중표
  expect('KRX:133690', { co: '미국' }); // TIGER 미국나스닥100
  expect('NYSEARCA:VT', { cp: 'MSCI ACWI' });
  expect('NYSE:TSM', { co: '대만' });
  expect('NASDAQ:AAPL', { co: '미국', se: '기술', g: 'us' });
  assert.ok(data.counts.kr > 2000 && data.counts['kr-etf'] > 600, `국내 개수 ${data.counts.kr}, ${data.counts['kr-etf']}`);
});
