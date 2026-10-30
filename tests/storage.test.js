import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../js/constants.js';
import {
  SCHEMA_VERSION, DataError, createDefaultData, migrate, normalizeData, loadData, saveData,
  createBackup, parseBackup, clearAppData, createMemoryBackend,
} from '../js/storage.js';
import { normalizeHolding } from '../js/holding.js';
import { normalizePension } from '../js/pension.js';

const NOW = new Date('2026-10-30T01:00:00Z');
const KEY = STORAGE_KEYS.data;

test('기본 데이터는 현재 스키마 버전과 기본 설정을 가진다', () => {
  const data = createDefaultData(NOW);
  assert.equal(data.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(data.settings, DEFAULT_SETTINGS);
  assert.deepEqual(data.holdings, []);
  assert.equal(data.settings.inflationRate, 2.5);
  assert.equal(data.settings.lifeExpectancy, 90);
  assert.equal(data.meta.createdAt, NOW.toISOString());
});

test('저장된 데이터가 없으면 기본값으로 시작한다', () => {
  const result = loadData(createMemoryBackend(), { now: NOW });
  assert.equal(result.status, 'new');
  assert.deepEqual(result.data, createDefaultData(NOW));
});

test('저장 → 다시 읽기 하면 같은 데이터가 나온다', () => {
  const backend = createMemoryBackend();
  const data = createDefaultData(NOW);
  data.settings.theme = 'dark';
  data.holdings.push(normalizeHolding({ id: 'h1', name: '테스트 종목', ticker: 'KRX:005930', quantity: 3 }));
  saveData(backend, data);

  const result = loadData(backend, { now: NOW });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.data, data);
});

test('JSON이 깨져 있으면 원본을 따로 보관하고 기본값으로 시작한다', () => {
  const backend = createMemoryBackend({ [KEY]: '{깨진 데이터' });
  const result = loadData(backend, { now: NOW });
  assert.equal(result.status, 'corrupt');
  assert.deepEqual(result.data, createDefaultData(NOW));
  assert.equal(backend.getItem(result.backupKey), '{깨진 데이터');
  // 원래 키는 덮어쓰지 않는다
  assert.equal(backend.getItem(KEY), '{깨진 데이터');
});

test('객체가 아닌 JSON도 손상된 데이터로 처리한다', () => {
  for (const raw of ['[]', '42', 'null', '"text"']) {
    const result = loadData(createMemoryBackend({ [KEY]: raw }), { now: NOW });
    assert.equal(result.status, 'corrupt', raw);
  }
});

test('schemaVersion이 없는 예전 데이터는 변환하고, 변환 전 원본을 보관한다', () => {
  const legacy = { holdings: [{ id: 'a', name: '삼성전자' }], settings: { inflationRate: 3 } };
  const raw = JSON.stringify(legacy);
  const backend = createMemoryBackend({ [KEY]: raw });

  const result = loadData(backend, { now: NOW });
  assert.equal(result.status, 'migrated');
  assert.equal(result.fromVersion, 0);
  assert.equal(result.data.schemaVersion, SCHEMA_VERSION);
  assert.equal(result.data.holdings.length, 1);
  assert.equal(result.data.holdings[0].id, 'a');
  assert.equal(result.data.holdings[0].name, '삼성전자');
  assert.equal(result.data.settings.inflationRate, 3);
  assert.equal(result.data.settings.lifeExpectancy, 90);
  assert.equal(backend.getItem(result.backupKey), raw);
  assert.equal(JSON.parse(backend.getItem(KEY)).schemaVersion, SCHEMA_VERSION);
});

test('더 새로운 버전의 데이터는 덮어쓰지 않도록 newer 상태를 돌려준다', () => {
  const raw = JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, holdings: [], settings: {} });
  const backend = createMemoryBackend({ [KEY]: raw });
  const result = loadData(backend, { now: NOW });
  assert.equal(result.status, 'newer');
  assert.equal(backend.getItem(KEY), raw);
});

test('migrate는 버전 순서대로 변환 함수를 실행한다', () => {
  const calls = [];
  const migrations = {
    1: (data) => { calls.push(1); return { ...data, renamed: data.old }; },
    2: (data) => { calls.push(2); const { old, ...rest } = data; return rest; },
  };
  const result = migrate({ schemaVersion: 1, old: 'x' }, { migrations, targetVersion: 3 });
  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(result, { schemaVersion: 3, renamed: 'x' });
});

test('migrate: 변환 함수가 없거나 더 새 버전이면 DataError', () => {
  assert.throws(() => migrate({ schemaVersion: 1 }, { migrations: {}, targetVersion: 2 }),
    (error) => error instanceof DataError && error.code === 'no-migration');
  assert.throws(() => migrate({ schemaVersion: 5 }, { targetVersion: 2 }),
    (error) => error instanceof DataError && error.code === 'newer');
  assert.throws(() => migrate([]), (error) => error.code === 'invalid');
});

test('migrate는 입력 객체를 바꾸지 않는다', () => {
  const input = { holdings: [] };
  migrate(input);
  assert.equal(Object.hasOwn(input, 'schemaVersion'), false);
});

test('normalizeData: 빠진 항목은 기본값, 잘못된 값은 정리', () => {
  const data = normalizeData({
    holdings: [{ id: 'a' }, null, 3, 'x'],
    otherAssets: 'not array',
    targets: { mode: 'weird', assetClass: { 성장주: 60, 채권: -5, 배당주: 'x' } },
    settings: { theme: 'neon', warnSector: 35, unknownKey: true },
  });
  assert.deepEqual(data.holdings, [normalizeHolding({ id: 'a' })]);
  assert.deepEqual(data.otherAssets, []);
  assert.deepEqual(data.targets, { mode: 'assetClass', assetClass: { 성장주: 60 }, ticker: {} });
  assert.equal(data.settings.theme, 'system');
  assert.equal(data.settings.warnSector, 35);
  assert.equal(Object.hasOwn(data.settings, 'unknownKey'), false);
});

test('백업 → 복원 하면 같은 데이터가 나온다', () => {
  const data = createDefaultData(NOW);
  data.settings.birthYear = 1980;
  data.pensions.push(normalizePension({ id: 'p1', name: '공무원연금', kind: 'fixed' }));
  const text = createBackup(data, NOW);
  assert.equal(JSON.parse(text).app, 'asset-app');
  assert.deepEqual(parseBackup(text), data);
});

test('백업 복원: 감싸지 않은 데이터 JSON도 받는다', () => {
  const data = createDefaultData(NOW);
  assert.deepEqual(parseBackup(JSON.stringify(data)), data);
});

test('백업 복원: 잘못된 파일은 이해하기 쉬운 오류를 낸다', () => {
  assert.throws(() => parseBackup('not json'), (error) => error.code === 'not-json');
  assert.throws(() => parseBackup('{"foo": 1}'), (error) => error.code === 'not-backup');
  assert.throws(() => parseBackup('[1,2]'), (error) => error.code === 'not-backup');
  assert.throws(() => parseBackup(JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, holdings: [] })),
    (error) => error.code === 'newer');
});

test('clearAppData는 이 앱의 키만 지운다', () => {
  const backend = createMemoryBackend({
    [KEY]: '{}',
    [STORAGE_KEYS.priceCache]: '{}',
    'otherApp.data': 'keep',
  });
  assert.equal(clearAppData(backend), 2);
  assert.equal(backend.getItem(KEY), null);
  assert.equal(backend.getItem('otherApp.data'), 'keep');
});
