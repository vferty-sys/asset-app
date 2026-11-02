import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ASSET_CLASSES } from '../js/constants.js';
import { CLASS_EXAMPLES, canBuyOverseas, examplesFor } from '../js/rebalance-examples.js';
import { expandItem } from '../js/stock-list.js';

const items = JSON.parse(readFileSync(new URL('../data/stocks.json', import.meta.url), 'utf8')).items.map(expandItem);
const byTicker = new Map(items.map((item) => [item.ticker, item]));

test('모든 자산군에 국내 상장 예시가 2개 이상 있다', () => {
  for (const name of ASSET_CLASSES) {
    assert.ok(CLASS_EXAMPLES[name], name);
    assert.ok(CLASS_EXAMPLES[name].domestic.length >= 2, name);
    for (const example of CLASS_EXAMPLES[name].domestic) {
      assert.match(example.ticker, /^KRX:/, example.ticker);
      assert.equal(example.currency, 'KRW', example.ticker);
    }
    for (const example of CLASS_EXAMPLES[name].overseas) {
      assert.match(example.ticker, /^(NYSE|NASDAQ|NYSEARCA):/, example.ticker);
      assert.equal(example.currency, 'USD', example.ticker);
    }
  }
});

// 매달 목록을 새로 만들 때 상장폐지 등으로 빠진 예시는 화면에서 숨기므로, 목록에 있는 예시만 검사한다
// (빠졌다고 테스트를 실패시키면 목록 갱신이 멈춘다).
test('종목 목록에 있는 예시는 ETF이고 자산군·통화가 목록과 같다', () => {
  let found = 0;
  for (const [name, set] of Object.entries(CLASS_EXAMPLES)) {
    for (const example of [...set.domestic, ...set.overseas]) {
      const item = byTicker.get(example.ticker);
      if (!item) continue;
      found += 1;
      assert.equal(item.type, 'etf', example.ticker);
      assert.equal(item.assetClass, name, `${example.ticker} ${item.name}`);
      assert.equal(item.currency, example.currency, example.ticker);
    }
  }
  assert.ok(found >= 20, `목록에서 찾은 예시 ${found}개`);
});

test('계좌에 맞춰 보여 준다: 연금저축·IRP·ISA는 국내 상장만, 일반·기타·전체는 미국 상장도 (최대 4개)', () => {
  for (const account of ['연금저축', 'IRP', 'ISA']) {
    const list = examplesFor('채권', account, items);
    assert.ok(list.length >= 2 && list.length <= 4, account);
    assert.ok(list.every((example) => !example.overseas), account);
  }
  for (const account of ['일반', '기타', null]) {
    const list = examplesFor('성장주', account, items);
    assert.equal(list.length, 4, String(account));
    assert.equal(list.filter((example) => example.overseas).length, 2, String(account));
  }
  assert.equal(canBuyOverseas(null), true);
  assert.equal(canBuyOverseas('IRP'), false);
});

test('목록의 이름을 쓰고, 목록에 없는 예시는 숨기고, 목록을 못 받으면 적어 둔 이름으로', () => {
  const renamed = items.map((item) => (item.ticker === 'KRX:069500' ? { ...item, name: 'KODEX 200 (새 이름)' } : item))
    .filter((item) => item.ticker !== 'KRX:360750');
  const list = examplesFor('성장주', 'IRP', renamed);
  assert.equal(list[0].name, 'KODEX 200 (새 이름)');
  assert.ok(list[0].item);
  assert.ok(!list.some((example) => example.ticker === 'KRX:360750'));

  const offline = examplesFor('성장주', 'IRP', null);
  assert.deepEqual(offline.map((example) => example.name), CLASS_EXAMPLES.성장주.domestic.map((example) => example.name));
  assert.equal(offline[0].item, null);
  assert.deepEqual(examplesFor('없는 자산군', '일반', items), []);
});
