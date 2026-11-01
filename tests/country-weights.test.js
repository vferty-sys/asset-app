// 국가 비중표(js/country-weights.js) 검사: 비중표를 고칠 때 합계·나라 이름이 틀리면 여기서 실패한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNTRY_PRESETS, COUNTRY_WEIGHTS, GLOBAL_COUNTRY, holdingCountryMix, presetMix, singleCountryOf, weightTableIssues,
} from '../js/country-weights.js';
import { COUNTRY_OPTIONS, NON_COUNTRY_NAMES } from '../js/constants.js';

test('비중표: 항목마다 합계 1.0, 나라 이름은 모두 앱의 국가 선택지에 있다', () => {
  assert.deepEqual(weightTableIssues(), []);
  for (const [key, weights] of Object.entries(COUNTRY_WEIGHTS.etf_country_weights)) {
    for (const [country, weight] of Object.entries(weights)) {
      assert.ok(COUNTRY_OPTIONS.includes(country), `${key}: ${country}`);
      assert.ok(weight > 0 && weight < 1, `${key}: ${country} ${weight}`);
    }
  }
  for (const country of Object.values(COUNTRY_WEIGHTS.single_country)) assert.ok(COUNTRY_OPTIONS.includes(country), country);
  assert.match(COUNTRY_WEIGHTS.meta.updated_at, /^\d{4}-\d{2}-\d{2}$/);
});

test('비중표에 없는 다국가는 글로벌(다국가): 국가 선택지에 있고, 쏠림 경고·점수에서는 뺀다', () => {
  assert.equal(GLOBAL_COUNTRY, '글로벌(다국가)');
  assert.ok(COUNTRY_OPTIONS.includes(GLOBAL_COUNTRY));
  assert.ok(NON_COUNTRY_NAMES.includes(GLOBAL_COUNTRY));
});

test('비중표 항목 → 퍼센트 비율, 합계가 1.0이 아니면 찾아낸다', () => {
  assert.deepEqual(COUNTRY_PRESETS, ['MSCI World', 'MSCI ACWI', 'MSCI EM']);
  const world = presetMix('MSCI World');
  assert.equal(world.미국, 72);
  assert.equal(world.일본, 5.5);
  assert.equal(Object.values(world).reduce((sum, value) => sum + value, 0), 100);
  assert.equal(presetMix('없는 지수'), null);
  assert.equal(presetMix('toString'), null);

  const broken = { etf_country_weights: { 좋음: { 미국: 0.6, 기타: 0.4 }, 모자람: { 미국: 0.6, 일본: 0.3 } } };
  assert.deepEqual(weightTableIssues(broken), [{ key: '모자람', sum: 0.9 }]);
});

test('종목명의 한 나라 지수 이름 (띄어쓰기·대소문자 무시)', () => {
  assert.equal(singleCountryOf('TIGER 미국S&P500'), '미국');
  assert.equal(singleCountryOf('ACE 미국 S&P 500'), '미국');
  assert.equal(singleCountryOf('KODEX 미국나스닥100TR'), '미국');
  assert.equal(singleCountryOf('TIGER 일본닛케이225'), '일본');
  assert.equal(singleCountryOf('KODEX 코스피200선물'), '한국');
  assert.equal(singleCountryOf('KODEX 반도체'), null);
});

test('종목의 국가 비율: 비중표 항목은 지금 비중표 값, 빠진 항목은 글로벌(다국가), 아니면 저장된 비율', () => {
  assert.deepEqual(holdingCountryMix({ countryPreset: 'MSCI EM', countryMix: { 미국: 100 } }), presetMix('MSCI EM'));
  assert.deepEqual(holdingCountryMix({ countryPreset: '예전 지수', countryMix: { 미국: 100 } }), { [GLOBAL_COUNTRY]: 100 });
  assert.deepEqual(holdingCountryMix({ countryPreset: null, countryMix: { 미국: 60, 한국: 40 } }), { 미국: 60, 한국: 40 });
  assert.deepEqual(holdingCountryMix({}), {});
});
