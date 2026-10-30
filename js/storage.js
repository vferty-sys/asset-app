// LocalStorage 읽기/쓰기, 스키마 버전 관리(마이그레이션), 백업/복원.
// 브라우저 저장소(backend)를 인자로 받아서 Node 테스트에서도 그대로 검증할 수 있다.

import {
  STORAGE_KEYS, STORAGE_PREFIX, SETTINGS_SCHEMA, META_SCHEMA, TARGET_MODES,
} from './constants.js';
import { isPlainObject, sanitizeObject } from './validate.js';
import { normalizeHolding } from './holding.js';

// 데이터 구조를 바꿀 때마다 1씩 올리고 MIGRATIONS에 변환 함수를 추가한다.
export const SCHEMA_VERSION = 1;

// 키 n: n버전 데이터를 n+1버전으로 바꾸는 함수.
// 새 필드 추가처럼 기본값만 채우면 되는 변경은 normalizeData가 처리하므로 마이그레이션이 필요 없다.
export const MIGRATIONS = Object.freeze({
  // 0버전: schemaVersion이 없는 데이터(직접 만든 JSON 등). 필드 구조가 같으므로 버전만 붙인다.
  0: (data) => ({ ...data }),
});

const BACKUP_APP_ID = 'asset-app';
const KNOWN_TOP_KEYS = ['schemaVersion', 'holdings', 'otherAssets', 'pensions', 'targets', 'settings', 'snapshots'];

export class DataError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DataError';
    this.code = code;
  }
}

export function createDefaultData(now = new Date()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    holdings: [],
    otherAssets: [],
    pensions: [],
    targets: { mode: 'assetClass', assetClass: {}, ticker: {} },
    settings: sanitizeObject(SETTINGS_SCHEMA, {}),
    snapshots: [],
    meta: { ...sanitizeObject(META_SCHEMA, {}), createdAt: now.toISOString() },
  };
}

export function versionOf(data) {
  return Number.isInteger(data?.schemaVersion) && data.schemaVersion >= 0 ? data.schemaVersion : 0;
}

export function migrate(data, { migrations = MIGRATIONS, targetVersion = SCHEMA_VERSION } = {}) {
  if (!isPlainObject(data)) throw new DataError('invalid', '데이터 형식이 올바르지 않아요.');
  let version = versionOf(data);
  if (version > targetVersion) {
    throw new DataError('newer', '더 새로운 버전의 앱에서 저장한 데이터예요.');
  }
  let result = structuredClone(data);
  while (version < targetVersion) {
    const step = migrations[version];
    if (typeof step !== 'function') {
      throw new DataError('no-migration', `${version}버전 데이터를 변환하는 방법이 없어요.`);
    }
    result = step(result);
    version += 1;
    result.schemaVersion = version;
  }
  return result;
}

function objectList(value) {
  return Array.isArray(value) ? value.filter(isPlainObject).map((item) => structuredClone(item)) : [];
}

function numberMap(value) {
  if (!isPlainObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v >= 0),
  );
}

function normalizeTargets(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    mode: TARGET_MODES.includes(source.mode) ? source.mode : 'assetClass',
    assetClass: numberMap(source.assetClass),
    ticker: numberMap(source.ticker),
  };
}

// 현재 버전 구조로 맞춘다: 빠진 항목은 기본값으로, 형식이 틀린 값은 버린다.
export function normalizeData(raw) {
  const source = isPlainObject(raw) ? raw : {};
  return {
    schemaVersion: SCHEMA_VERSION,
    holdings: objectList(source.holdings).map(normalizeHolding),
    otherAssets: objectList(source.otherAssets),
    pensions: objectList(source.pensions),
    targets: normalizeTargets(source.targets),
    settings: sanitizeObject(SETTINGS_SCHEMA, source.settings),
    snapshots: objectList(source.snapshots),
    meta: sanitizeObject(META_SCHEMA, source.meta),
  };
}

function keepCopy(backend, key, raw) {
  try {
    backend.setItem(key, raw);
    return key;
  } catch {
    return null;
  }
}

// 저장된 데이터를 읽는다. status:
//  'new'      저장된 데이터 없음 (기본값으로 시작)
//  'ok'       정상
//  'migrated' 예전 버전을 변환함 (변환 전 원본은 별도 키에 보관)
//  'corrupt'  읽을 수 없어 기본값으로 시작 (원본은 별도 키에 보관)
//  'newer'    더 새로운 앱 버전의 데이터 — 덮어쓰지 않도록 저장을 막아야 함
//  'unavailable' 저장소 접근 불가
export function loadData(backend, { now = new Date() } = {}) {
  let raw;
  try {
    raw = backend.getItem(STORAGE_KEYS.data);
  } catch (error) {
    return { data: createDefaultData(now), status: 'unavailable', error };
  }
  if (raw == null) return { data: createDefaultData(now), status: 'new' };

  const recoverCorrupt = (error) => {
    const backupKey = keepCopy(backend, `${STORAGE_KEYS.data}.corrupt-${now.getTime()}`, raw);
    return { data: createDefaultData(now), status: 'corrupt', backupKey, error };
  };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return recoverCorrupt(error);
  }
  if (!isPlainObject(parsed)) return recoverCorrupt(new DataError('invalid', '데이터 형식이 올바르지 않아요.'));

  const fromVersion = versionOf(parsed);
  if (fromVersion > SCHEMA_VERSION) {
    return { data: normalizeData(parsed), status: 'newer', fromVersion };
  }

  let data;
  try {
    data = normalizeData(migrate(parsed));
  } catch (error) {
    return recoverCorrupt(error);
  }
  if (fromVersion === SCHEMA_VERSION) return { data, status: 'ok', fromVersion };

  const backupKey = keepCopy(backend, `${STORAGE_KEYS.data}.before-v${SCHEMA_VERSION}`, raw);
  try {
    saveData(backend, data);
  } catch {
    // 저장에 실패해도 변환된 데이터로 계속 쓸 수 있다. 다음 변경 때 다시 저장을 시도한다.
  }
  return { data, status: 'migrated', fromVersion, backupKey };
}

export function saveData(backend, data) {
  backend.setItem(STORAGE_KEYS.data, JSON.stringify(data));
}

export function createBackup(data, now = new Date()) {
  const payload = { app: BACKUP_APP_ID, exportedAt: now.toISOString(), schemaVersion: data.schemaVersion, data };
  return JSON.stringify(payload, null, 2);
}

// 백업 파일 내용을 읽어 현재 버전 데이터로 만든다. 문제가 있으면 DataError(사용자용 메시지)를 던진다.
export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DataError('not-json', '파일을 읽을 수 없어요. 이 앱에서 내보낸 백업 파일(.json)인지 확인해 주세요.');
  }
  const payload = parsed?.app === BACKUP_APP_ID ? parsed.data : parsed;
  if (!isPlainObject(payload) || !KNOWN_TOP_KEYS.some((key) => Object.hasOwn(payload, key))) {
    throw new DataError('not-backup', '이 앱의 백업 파일이 아니에요.');
  }
  if (versionOf(payload) > SCHEMA_VERSION) {
    throw new DataError('newer', '더 새로운 버전의 앱에서 만든 백업이에요. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
  }
  return normalizeData(migrate(payload));
}

// 이 앱이 만든 키만 지운다 (같은 주소의 다른 앱 데이터는 건드리지 않음).
export function clearAppData(backend) {
  const keys = [];
  for (let i = 0; i < backend.length; i += 1) {
    const key = backend.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => backend.removeItem(key));
  return keys.length;
}

// 테스트용, 그리고 브라우저 저장소를 쓸 수 없을 때(사생활 보호 모드 등) 쓰는 메모리 저장소.
export function createMemoryBackend(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size; },
  };
}

export function pickStorageBackend() {
  try {
    const storage = globalThis.localStorage;
    const probeKey = `${STORAGE_PREFIX}probe`;
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return { backend: storage, persistent: true };
  } catch {
    return { backend: createMemoryBackend(), persistent: false };
  }
}
