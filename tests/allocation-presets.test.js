// 추천 자산 배분 비율: 비율 합계, 나이만큼 채권, 앱 자산군으로 바꾸기(주식 몫을 성장주·배당주로)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOCATION_PRESETS, growthShareOf, presetById, presetMix, presetTargets, safeShare,
} from '../js/calc/allocation-presets.js';
import { ASSET_CLASSES } from '../js/constants.js';

const sum = (object) => Object.values(object).reduce((total, value) => total + value, 0);

test('모든 추천 비율은 합계 100이고 앱 자산군만 쓴다', () => {
  assert.equal(new Set(ALLOCATION_PRESETS.map((preset) => preset.id)).size, ALLOCATION_PRESETS.length);
  for (const preset of ALLOCATION_PRESETS) {
    const mix = presetMix(preset, { age: 47 });
    assert.equal(sum(mix), 100, preset.id);
    const targets = presetTargets(mix, { growthShare: 0.8 });
    assert.equal(Math.round(sum(targets) * 10) / 10, 100, preset.id);
    assert.ok(Object.keys(targets).every((name) => ASSET_CLASSES.includes(name)), preset.id);
    assert.ok(preset.name && preset.by && preset.summary, preset.id);
  }
});

test('알려진 비율 그대로', () => {
  assert.deepEqual(presetMix(presetById('sixty-forty')), { stocks: 60, bonds: 40 });
  assert.deepEqual(presetMix(presetById('buffett')), { stocks: 90, cash: 10 });
  assert.deepEqual(presetMix(presetById('all-weather')), { stocks: 30, bonds: 55, other: 15 });
  assert.deepEqual(presetMix(presetById('permanent')), { stocks: 25, bonds: 25, cash: 25, other: 25 });
  assert.deepEqual(presetMix(presetById('yale')), { stocks: 50, bonds: 30, other: 20 });
});

test('나이만큼 채권: 나이가 있어야 하고, 10~90% 사이로', () => {
  const bogle = presetById('bogle');
  assert.deepEqual(presetMix(bogle, { age: 47 }), { stocks: 53, bonds: 47 });
  assert.equal(presetMix(bogle), null);
  assert.deepEqual(presetMix(bogle, { age: 5 }), { stocks: 90, bonds: 10 });
  assert.deepEqual(presetMix(bogle, { age: 99 }), { stocks: 10, bonds: 90 });
  assert.equal(presetTargets(null), null);
});

test('주식 몫은 지금 계좌의 성장주:배당주 비율대로 나눈다 (예: 80:20, 60/40 → 48·12·40)', () => {
  assert.deepEqual(presetTargets({ stocks: 60, bonds: 40 }, { growthShare: 0.8 }), { 성장주: 48, 배당주: 12, 채권: 40 });
  assert.deepEqual(presetTargets({ stocks: 60, bonds: 40 }), { 성장주: 60, 채권: 40 });
  assert.deepEqual(presetTargets({ stocks: 25, bonds: 25, cash: 25, other: 25 }, { growthShare: 0 }), { 배당주: 25, 채권: 25, 현금성: 25, 기타: 25 });
  // 나눠도 소수 첫째 자리로 맞고 합계 100
  const odd = presetTargets({ stocks: 53, bonds: 47 }, { growthShare: 2 / 3 });
  assert.deepEqual(odd, { 성장주: 35.3, 배당주: 17.7, 채권: 47 });
});

test('지금 계좌의 성장주 몫, 안전자산 비율', () => {
  assert.ok(Math.abs(growthShareOf([{ name: '성장주', weight: 0.6 }, { name: '배당주', weight: 0.15 }, { name: '채권', weight: 0.25 }]) - 0.8) < 1e-12);
  assert.equal(growthShareOf([{ name: '채권', weight: 1 }]), 1);
  assert.equal(growthShareOf(), 1);
  assert.equal(safeShare(presetMix(presetById('buffett'))), 10);
  assert.equal(safeShare(presetMix(presetById('permanent'))), 50);
});
