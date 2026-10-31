// 종목 목록 파일(data/stocks.json) 검사: 매달 자동으로 새로 만들 때도 이 검사를 통과해야 저장한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ASSET_CLASSES, COUNTRY_OPTIONS, CURRENCIES, ETF_SPREADS, SECTOR_OPTIONS } from '../js/constants.js';

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
  }
});
