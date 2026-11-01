// 기기 연동: 노트북·회사 PC처럼 여러 기기에서 같은 자산 데이터를 고치고 본다.
// 데이터는 '연동 비밀번호'로 암호화해서 사용자의 구글 시트(시세에 쓰는 Apps Script 웹 앱)의 숨긴 탭에 저장한다.
//  - 비밀번호 → PBKDF2(SHA-256, 60만 번, 솔트) → 64바이트. 앞 32바이트는 AES-GCM 암호 키, 뒤 32바이트는
//    시트가 '이 기기가 비밀번호를 안다'고 확인하는 값(auth). 비밀번호 자체는 어디에도 저장하지 않는다.
//  - 저장할 때 이 기기가 마지막으로 받은 번호(revision)를 함께 보내, 다른 기기가 먼저 저장했으면 덮어쓰지 않는다.
//    그때는 '다른 기기에서 더 최근에 고쳤어요'로 알리고 최신 내용을 먼저 받아 오게 한다.
//  - '이 기기에 비밀번호 기억하기'를 끄면(회사·공용 PC) 키와 자산 데이터를 브라우저를 닫으면 사라지는 저장소
//    (sessionStorage)에 둔다. 다시 열면 비밀번호를 입력해 최신 데이터를 받아 온다.
// 시트 쪽 코드는 apps-script/Code.gs의 '기기 연동'.

import { STORAGE_KEYS, STORAGE_PREFIX } from './constants.js';
import { SCHEMA_VERSION, migrate, normalizeData, versionOf } from './storage.js';
import { isPlainObject } from './validate.js';

export const SYNC_KEYS = Object.freeze({
  // 이 기기의 연동 설정 (늘 localStorage): { url, salt, deviceName, remember }
  config: `${STORAGE_PREFIX}sync`,
  // 마지막으로 맞춘 번호와 그때 데이터의 해시 (자산 데이터와 같은 저장소에 둔다)
  progress: `${STORAGE_PREFIX}syncState`,
  // 비밀번호로 만든 키 { encKey, auth } (기억하기: localStorage, 아니면 sessionStorage)
  key: `${STORAGE_PREFIX}syncKey`,
});

export const PBKDF2_ITERATIONS = 600_000;
export const SYNC_TIMEOUT_MS = 30_000;
export const PASSWORD_MIN_LENGTH = 8;

const MESSAGES = {
  network: '시트에 연결하지 못했어요. 인터넷 연결을 확인해 주세요. 연결되면 다시 맞춰요.',
  timeout: '시트가 응답하지 않아요. 잠시 뒤 다시 맞춰요.',
  notJson: '시트 주소의 응답을 읽지 못했어요. 웹 앱 주소와 배포 권한("모든 사용자")을 확인해 주세요.',
  'old-code': '시트 코드가 예전 버전이라 연동을 쓸 수 없어요. 연결 가이드의 새 코드를 Apps Script에 붙여넣고 "새 버전"으로 다시 배포해 주세요.',
  auth: '연동 비밀번호가 맞지 않아요.',
  'not-setup': '시트에 연동 데이터가 없어요. "앱 데이터" 탭이 지워졌다면 연동을 다시 켜 주세요.',
  exists: '이미 다른 기기에서 연동을 켰어요. 그때 정한 비밀번호로 연결해 주세요.',
  decrypt: '데이터를 풀지 못했어요. 연동 비밀번호를 확인해 주세요.',
  newer: '더 새로운 버전의 앱에서 저장한 데이터예요. 페이지를 새로고침해 주세요.',
  format: '시트에 저장된 연동 데이터를 읽지 못했어요.',
};

export class SyncError extends Error {
  constructor(code, message = MESSAGES[code] ?? MESSAGES.format) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
  }
}

// ── 바이트 ↔ base64 ─────────────────────────────────
export function toBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

export function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ── 암호화 ───────────────────────────────────────────
const canZip = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

export function randomSalt() {
  return toBase64(crypto.getRandomValues(new Uint8Array(16)));
}

// 비밀번호 → { encKey: 암호 키, auth: 시트 확인값 } (모두 base64). 맥·윈도에서 한글 자모가 다르게 들어와도 같게 NFC로 맞춘다.
export async function deriveSyncKeys(password, salt, { iterations = PBKDF2_ITERATIONS } = {}) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password).normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt), iterations }, material, 512));
  return { encKey: toBase64(bits.slice(0, 32)), auth: toBase64(bits.slice(32)) };
}

function aesKey(encKey, usage) {
  return crypto.subtle.importKey('raw', fromBase64(encKey), 'AES-GCM', false, [usage]);
}

// 데이터 → { iv, zip, data } (JSON → gzip → AES-GCM)
export async function encryptData(data, encKey) {
  let bytes = new TextEncoder().encode(JSON.stringify(data));
  if (canZip) bytes = await pipe(bytes, new CompressionStream('gzip'));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(encKey, 'encrypt'), bytes));
  return { iv: toBase64(iv), zip: canZip ? 'gzip' : 'none', data: toBase64(cipher) };
}

export async function decryptData(payload, encKey) {
  let bytes;
  try {
    bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(payload.iv) }, await aesKey(encKey, 'decrypt'), fromBase64(payload.data)));
  } catch {
    throw new SyncError('decrypt');
  }
  if (payload.zip === 'gzip') {
    if (!canZip) throw new SyncError('format', '이 브라우저는 연동 데이터를 풀 수 없어요. 최신 브라우저로 열어 주세요.');
    bytes = await pipe(bytes, new DecompressionStream('gzip'));
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new SyncError('format');
  }
}

// 받은 데이터를 지금 앱 구조로 (백업 복원과 같은 정리)
export function toAppData(raw) {
  if (!isPlainObject(raw)) throw new SyncError('format');
  if (versionOf(raw) > SCHEMA_VERSION) throw new SyncError('newer');
  return normalizeData(migrate(raw));
}

// 데이터가 바뀌었는지 보는 짧은 해시 (FNV-1a)
export function hashData(data) {
  const text = JSON.stringify(data);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

// 시트와 이 기기를 맞출 때 할 일
//  pull: 시트의 최신 데이터를 받아 온다 / push: 이 기기에서 고친 것을 저장한다
//  conflict: 이 기기도 고쳤고 다른 기기도 더 최근에 저장했다 → 사용자에게 묻는다 / none: 이미 같다
// 이 기기가 한 번도 받은 적이 없으면(새 기기·브라우저를 다시 연 경우) 먼저 받는다 — 빈 데이터로 덮어쓰지 않게.
export function decideSync({ localRevision, remoteRevision, dirty }) {
  if (!(localRevision > 0)) return 'pull';
  if (remoteRevision > localRevision) return dirty ? 'conflict' : 'pull';
  if (remoteRevision < localRevision) return 'pull';
  return dirty ? 'push' : 'none';
}

// 기기 이름 기본값 (설정에서 바꿀 수 있다)
export function guessDeviceName(userAgent = globalThis.navigator?.userAgent ?? '') {
  if (/iPhone/i.test(userAgent)) return 'iPhone';
  if (/iPad/i.test(userAgent)) return 'iPad';
  if (/Android/i.test(userAgent)) return /Mobile/i.test(userAgent) ? '안드로이드 폰' : '안드로이드 태블릿';
  if (/Windows/i.test(userAgent)) return 'Windows PC';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'Mac';
  return '이 기기';
}

// ── 시트와 주고받기 ───────────────────────────────────
async function request(url, init, { fetchImpl = globalThis.fetch, timeoutMs = SYNC_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, cache: 'no-store', credentials: 'omit', redirect: 'follow', signal: controller.signal });
    if (!response.ok) throw new SyncError('http', `시트 주소에서 오류가 났어요 (응답 코드 ${response.status}).`);
    try {
      return JSON.parse(await response.text());
    } catch {
      throw new SyncError('not-json', MESSAGES.notJson);
    }
  } catch (error) {
    if (error instanceof SyncError) throw error;
    throw new SyncError(controller.signal.aborted ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
}

// 비밀번호 없이 볼 수 있는 연동 상태: { exists, salt, hint, revision, savedAt, device }
export async function fetchSyncInfo(url, options) {
  const json = await request(`${url}?action=sync-info`, { method: 'GET' }, options);
  if (!isPlainObject(json) || json.sync !== 1) throw new SyncError('old-code');
  return json;
}

// 저장·불러오기 요청. 시트 코드가 오류로 답하면 SyncError
export async function postSync(url, body, options) {
  // text/plain으로 보내야 브라우저가 따로 허락을 묻지 않고(Apps Script는 그 요청에 답하지 못함) 바로 보낸다
  const json = await request(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }, options);
  if (!isPlainObject(json)) throw new SyncError('format');
  if (json.error) throw new SyncError(json.error, MESSAGES[json.error] ?? json.message);
  return json;
}

// ── 이 기기에 저장해 두는 연동 정보 ─────────────────────
function readJson(storage, key) {
  try {
    const value = JSON.parse(storage?.getItem(key) ?? 'null');
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

function writeJson(storage, key, value) {
  storage.setItem(key, JSON.stringify(value));
}

export function readSyncConfig(local) {
  const config = readJson(local, SYNC_KEYS.config);
  if (!config || typeof config.url !== 'string' || typeof config.salt !== 'string') return null;
  return { url: config.url, salt: config.salt, deviceName: String(config.deviceName ?? '이 기기'), remember: config.remember !== false };
}

// 자산 데이터를 어느 저장소에 둘지: 비밀번호를 기억하지 않는 기기는 브라우저를 닫으면 지워지는 저장소
export function dataStorageFor(config, { local, session }) {
  return config?.remember === false && session ? session : local;
}

// 이 앱이 만든 키만 지운다. 지운 개수
function removeAppKeys(storage, filter = () => true) {
  if (!storage) return 0;
  const keys = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith(STORAGE_PREFIX) && filter(key)) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
  return keys.length;
}

// 자산 데이터(복구용 사본 포함)와 연동 진행 정보만
const isDataKey = (key) => key.startsWith(STORAGE_KEYS.data) || key === SYNC_KEYS.progress;

// ── 연동 엔진 ─────────────────────────────────────────
// getState·replaceState·subscribe: state.js, switchBackend(storage): 자산 데이터를 저장할 곳을 바꾼다
// local·session: localStorage·sessionStorage (테스트에서는 메모리 저장소)
// status.state: off(꺼짐) | locked(비밀번호 필요) | syncing | synced | conflict | error
// autoSync: 데이터가 바뀌면 pushDelayMs 뒤에 저절로 저장 (테스트에서는 끄고 sync를 직접 부른다)
export function createSyncEngine({
  getState, replaceState, subscribe, switchBackend, local, session,
  fetchImpl = globalThis.fetch, pushDelayMs = 1500, autoSync = true, iterations = PBKDF2_ITERATIONS, now = () => new Date(),
}) {
  const options = { fetchImpl };
  const listeners = new Set();
  let config = readSyncConfig(local);
  let keys = null;
  let status = { state: 'off' };
  let conflict = null;
  let busy = null;
  let again = false;
  let timer = null;

  const dataStorage = () => dataStorageFor(config, { local, session });
  const progress = () => readJson(dataStorage(), SYNC_KEYS.progress) ?? { revision: 0, hash: '' };
  const setProgress = (value) => writeJson(dataStorage(), SYNC_KEYS.progress, value);
  const isDirty = () => hashData(getState()) !== progress().hash;

  function readKeys() {
    const found = readJson(session, SYNC_KEYS.key) ?? readJson(local, SYNC_KEYS.key);
    return found?.encKey && found?.auth ? { encKey: found.encKey, auth: found.auth } : null;
  }

  function storeKeys() {
    local.removeItem(SYNC_KEYS.key);
    session?.removeItem(SYNC_KEYS.key);
    if (keys) writeJson(dataStorage() === session ? session : local, SYNC_KEYS.key, keys);
  }

  function forgetKeys() {
    keys = null;
    storeKeys();
  }

  function setStatus(next) {
    status = { ...next, at: now().toISOString() };
    listeners.forEach((listener) => listener(status));
  }

  const syncedStatus = () => ({ state: 'synced', ...progress() });

  // 자산 데이터를 저장할 곳이 바뀌면 옮기고 예전 곳의 사본은 지운다 (회사 PC에 남지 않게)
  function moveData(from, to) {
    if (from === to) return;
    switchBackend(to);
    removeAppKeys(from, isDataKey);
  }

  function activate(nextConfig, derived) {
    const from = dataStorage();
    config = nextConfig;
    writeJson(local, SYNC_KEYS.config, config);
    keys = derived;
    moveData(from, dataStorage());
    storeKeys();
  }

  // 받은 기록을 이 기기에 적용한다. 진행 정보를 먼저 적어서, 바뀐 데이터를 다시 저장하려 하지 않게 한다.
  async function applyRecord(record, derived = keys) {
    const data = toAppData(await decryptData(record, derived.encKey));
    setProgress({ revision: record.revision, hash: hashData(data), savedAt: record.savedAt, device: record.device });
    replaceState(data);
    return data;
  }

  async function push(baseRevision = progress().revision) {
    const data = getState();
    const hash = hashData(data);
    const payload = await encryptData(data, keys.encKey);
    const result = await postSync(config.url, { action: 'sync-save', auth: keys.auth, baseRevision, device: config.deviceName, payload }, options);
    if (result.conflict) {
      conflict = result;
      setStatus({ state: 'conflict', remote: result });
      return false;
    }
    setProgress({ revision: result.revision, hash, savedAt: result.savedAt, device: config.deviceName });
    return true;
  }

  async function pull(revision) {
    const record = await postSync(config.url, { action: 'sync-load', auth: keys.auth, ...(revision ? { revision } : {}) }, options);
    return applyRecord(record);
  }

  function handleError(error) {
    if (error?.code === 'auth') {
      forgetKeys();
      setStatus({ state: 'locked', message: '연동 비밀번호가 바뀌었거나 맞지 않아요. 비밀번호를 다시 입력해 주세요.' });
      return;
    }
    setStatus({ state: 'error', message: error?.message ?? MESSAGES.network, code: error?.code ?? 'network' });
  }

  async function runSync() {
    setStatus({ state: 'syncing' });
    const info = await fetchSyncInfo(config.url, options);
    if (!info.exists) throw new SyncError('not-setup');
    if (info.salt !== config.salt) {
      // 다른 기기에서 연동을 새 비밀번호로 다시 켰다
      forgetKeys();
      setStatus({ state: 'locked', message: '다른 기기에서 연동을 다시 켰어요. 그때 정한 비밀번호를 입력해 주세요.', hint: info.hint });
      return;
    }
    const action = decideSync({ localRevision: progress().revision, remoteRevision: info.revision, dirty: isDirty() });
    if (action === 'conflict') {
      conflict = info;
      setStatus({ state: 'conflict', remote: info });
      return;
    }
    if (action === 'pull') await pull();
    if (action === 'push' && !(await push())) return;
    conflict = null;
    setStatus(syncedStatus());
  }

  // 시트와 맞춘다. 이미 맞추는 중이면 끝난 뒤 한 번 더.
  async function sync() {
    if (!config || !keys) return status;
    if (busy) {
      again = true;
      return busy;
    }
    busy = (async () => {
      try {
        await runSync();
      } catch (error) {
        handleError(error);
      } finally {
        busy = null;
      }
      if (again) {
        again = false;
        await sync();
      }
      return status;
    })();
    return busy;
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => { sync(); }, pushDelayMs);
  }

  subscribe(() => {
    if (autoSync && config && keys && status.state !== 'conflict' && isDirty()) schedule();
  });

  if (config) {
    keys = readKeys();
    status = keys ? { state: 'syncing' } : { state: 'locked' };
  }

  return {
    get status() { return status; },
    get config() { return config; },
    get conflict() { return conflict; },
    onStatus(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    sync,
    isDirty,

    // 시트의 연동 상태 (켜기 전에 처음 기기인지 확인)
    info: (url) => fetchSyncInfo(url, options),

    // 처음 켜는 기기: 지금 이 기기의 데이터를 첫 데이터로 저장한다
    async setup({ url, password, hint = '', deviceName, remember = true }) {
      const salt = randomSalt();
      const derived = await deriveSyncKeys(password, salt, { iterations });
      const data = getState();
      const payload = await encryptData(data, derived.encKey);
      const result = await postSync(url, { action: 'sync-setup', salt, hint, auth: derived.auth, device: deviceName, payload }, options);
      activate({ url, salt, deviceName, remember }, derived);
      setProgress({ revision: result.revision, hash: hashData(data), savedAt: result.savedAt, device: deviceName });
      setStatus(syncedStatus());
    },

    // 이미 켜진 연동에 연결: 비밀번호를 확인하고 시트의 데이터를 받아 둔다 (적용은 completeJoin)
    async prepareJoin({ url, password }) {
      const info = await fetchSyncInfo(url, options);
      if (!info.exists) throw new SyncError('not-setup');
      const derived = await deriveSyncKeys(password, info.salt, { iterations });
      const record = await postSync(url, { action: 'sync-load', auth: derived.auth }, options);
      const data = toAppData(await decryptData(record, derived.encKey));
      return { url, salt: info.salt, derived, record, data };
    },

    // 받아 둔 시트의 데이터로 이 기기의 데이터를 바꾸고 연동을 켠다
    async completeJoin(pending, { deviceName, remember = true }) {
      activate({ url: pending.url, salt: pending.salt, deviceName, remember }, pending.derived);
      await applyRecord(pending.record);
      conflict = null;
      setStatus(syncedStatus());
    },

    // 비밀번호를 기억하지 않는 기기에서 다시 열었을 때 (또는 비밀번호가 바뀌었을 때)
    async unlock(password) {
      const info = await fetchSyncInfo(config.url, options);
      if (!info.exists) throw new SyncError('not-setup');
      const derived = await deriveSyncKeys(password, info.salt, { iterations });
      await postSync(config.url, { action: 'sync-history', auth: derived.auth }, options);
      if (info.salt !== config.salt) {
        // 새로 켜진 연동이면 예전 진행 정보는 맞지 않으니 처음부터 받는다
        config = { ...config, salt: info.salt };
        writeJson(local, SYNC_KEYS.config, config);
        setProgress({ revision: 0, hash: '' });
      }
      keys = derived;
      storeKeys();
      return sync();
    },

    // 다른 기기가 더 최근에 저장했을 때: pull = 최신 내용 받아오기 / overwrite = 이 기기 내용으로 덮어쓰기
    async resolveConflict(choice) {
      if (!conflict) return status;
      try {
        setStatus({ state: 'syncing' });
        if (choice === 'overwrite') {
          if (!(await push(conflict.revision))) return status;
        } else {
          await pull();
        }
        conflict = null;
        setStatus(syncedStatus());
      } catch (error) {
        handleError(error);
      }
      return status;
    },

    async history() {
      const result = await postSync(config.url, { action: 'sync-history', auth: keys.auth }, options);
      return result.records ?? [];
    },

    // 예전 기록으로 되돌리기: 그 내용을 새 번호로 저장한다 (지금 내용도 기록에 남는다)
    async restore(revision) {
      await sync();
      if (status.state !== 'synced') return status;
      const record = await postSync(config.url, { action: 'sync-load', auth: keys.auth, revision }, options);
      const data = toAppData(await decryptData(record, keys.encKey));
      replaceState(data);
      return sync();
    },

    // 모든 기기에서 지우기: 빈 데이터를 새 번호로 저장한다 (예전 기록에는 남는다)
    async resetEverywhere(fresh) {
      await sync();
      if (status.state !== 'synced') return status;
      replaceState(fresh);
      return sync();
    },

    // 이 기기만 연동 끄기: 데이터는 이 기기(브라우저)에 그대로 남는다
    disconnect() {
      clearTimeout(timer);
      const from = dataStorage();
      config = null;
      conflict = null;
      local.removeItem(SYNC_KEYS.config);
      forgetKeys();
      moveData(from, local);
      local.removeItem(SYNC_KEYS.progress);
      session?.removeItem(SYNC_KEYS.progress);
      setStatus({ state: 'off' });
    },

    // 이 기기에서 데이터 삭제: 두 저장소의 이 앱 항목(연동 설정·키 포함)을 모두 지운다. 시트는 그대로
    wipeDevice() {
      clearTimeout(timer);
      config = null;
      keys = null;
      conflict = null;
      const removed = removeAppKeys(local) + removeAppKeys(session);
      setStatus({ state: 'off' });
      return removed;
    },
  };
}
