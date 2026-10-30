import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEYS } from '../js/constants.js';
import { SCHEMA_VERSION, createMemoryBackend } from '../js/storage.js';
import { initState, getState, updateState, subscribe, isPersistEnabled } from '../js/state.js';

test('updateState는 바로 저장하고 구독자에게 알린다', () => {
  const backend = createMemoryBackend();
  initState({ backend });
  const seen = [];
  const unsubscribe = subscribe((state) => seen.push(state.settings.theme));

  updateState((draft) => { draft.settings.theme = 'dark'; });
  assert.equal(getState().settings.theme, 'dark');
  assert.equal(JSON.parse(backend.getItem(STORAGE_KEYS.data)).settings.theme, 'dark');
  assert.deepEqual(seen, ['dark']);

  unsubscribe();
  updateState((draft) => { draft.settings.theme = 'light'; });
  assert.deepEqual(seen, ['dark']);
});

test('이전 상태 객체는 바뀌지 않는다', () => {
  initState({ backend: createMemoryBackend() });
  const before = getState();
  updateState((draft) => { draft.settings.inflationRate = 3; });
  assert.equal(before.settings.inflationRate, 2.5);
  assert.equal(getState().settings.inflationRate, 3);
});

test('더 새로운 버전의 데이터면 저장하지 않는다', () => {
  const raw = JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, settings: {} });
  const backend = createMemoryBackend({ [STORAGE_KEYS.data]: raw });
  initState({ backend });
  assert.equal(isPersistEnabled(), false);
  updateState((draft) => { draft.settings.theme = 'dark'; });
  assert.equal(backend.getItem(STORAGE_KEYS.data), raw);
});

test('저장에 실패하면 onSaveError가 불린다', () => {
  const backend = createMemoryBackend();
  backend.setItem = () => { throw new Error('QuotaExceededError'); };
  let failed = false;
  initState({ backend, onSaveError: () => { failed = true; } });
  updateState((draft) => { draft.settings.theme = 'dark'; });
  assert.equal(failed, true);
  assert.equal(getState().settings.theme, 'dark');
});
