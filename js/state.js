// 앱 데이터의 메모리 사본. 바꿀 때는 updateState로만 바꾸고, 바뀌면 즉시 저장한 뒤 구독자에게 알린다.

import { loadData, saveData } from './storage.js';

let backend = null;
let current = null;
let persistEnabled = true;
let handleSaveError = () => {};
const listeners = new Set();

function applyLoadResult(result) {
  current = result.data;
  persistEnabled = result.status !== 'newer' && result.status !== 'unavailable';
  return result;
}

export function initState({ backend: storageBackend, onSaveError } = {}) {
  backend = storageBackend;
  if (onSaveError) handleSaveError = onSaveError;
  return applyLoadResult(loadData(backend));
}

// 다른 탭에서 데이터가 바뀌었을 때 다시 읽는다.
export function reloadState() {
  const result = applyLoadResult(loadData(backend));
  notify();
  return result;
}

export function getState() {
  return current;
}

export function isPersistEnabled() {
  return persistEnabled;
}

export function updateState(mutate) {
  const draft = structuredClone(current);
  mutate(draft);
  current = draft;
  if (persistEnabled) {
    try {
      saveData(backend, current);
    } catch (error) {
      handleSaveError(error);
    }
  }
  notify();
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of [...listeners]) listener(current);
}
