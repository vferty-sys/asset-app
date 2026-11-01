// 기기 연동: 암호화, 맞출 때 할 일 판단, 그리고 노트북·회사 PC 두 기기가 진짜 Code.gs(가짜 시트)로 주고받는 흐름
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEYS } from '../js/constants.js';
import { createDefaultData, createMemoryBackend } from '../js/storage.js';
import {
  SYNC_KEYS, SyncError, createSyncEngine, decideSync, decryptData, deriveSyncKeys, encryptData, fetchSyncInfo, hashData,
  randomSalt,
} from '../js/sync.js';
import { FakeSheet, fakeWebAppFetch, load } from './helpers/apps-script-harness.js';

const URL_ = 'https://script.google.com/macros/s/TEST/exec';
const ITERATIONS = 1000; // 테스트는 빠르게 (앱은 60만 번)
const PASSWORD = '우리집 강아지 2015!';

test('비밀번호 → 키: 같은 비밀번호·솔트면 같고, 솔트가 다르면 다르다. 한글 자모 조합 방식이 달라도 같다', async () => {
  const salt = randomSalt();
  const a = await deriveSyncKeys(PASSWORD, salt, { iterations: ITERATIONS });
  assert.deepEqual(await deriveSyncKeys(PASSWORD, salt, { iterations: ITERATIONS }), a);
  assert.notDeepEqual(await deriveSyncKeys(PASSWORD, randomSalt(), { iterations: ITERATIONS }), a);
  assert.deepEqual(await deriveSyncKeys(PASSWORD.normalize('NFD'), salt, { iterations: ITERATIONS }), a);
  assert.notEqual(a.encKey, a.auth);
});

test('암호화: 풀면 그대로, 다른 비밀번호나 바뀐 데이터는 풀지 못한다', async () => {
  const salt = randomSalt();
  const { encKey } = await deriveSyncKeys(PASSWORD, salt, { iterations: ITERATIONS });
  const data = { holdings: [{ name: '삼성전자', quantity: 10 }], memo: '연금저축 🙂' };
  const payload = await encryptData(data, encKey);
  assert.equal(payload.zip, 'gzip');
  assert.ok(!payload.data.includes('삼성'));
  assert.deepEqual(await decryptData(payload, encKey), data);

  const other = await deriveSyncKeys('다른 비밀번호', salt, { iterations: ITERATIONS });
  await assert.rejects(decryptData(payload, other.encKey), (error) => error instanceof SyncError && error.code === 'decrypt');
  const tampered = { ...payload, data: `${payload.data.slice(0, -6)}AAAAAA` };
  await assert.rejects(decryptData(tampered, encKey), (error) => error.code === 'decrypt');
  // 같은 데이터도 저장할 때마다 다른 글자가 된다 (IV가 매번 다름)
  assert.notEqual((await encryptData(data, encKey)).data, payload.data);
});

test('맞출 때 할 일: 처음 기기는 먼저 받고, 양쪽이 다 고쳤으면 묻는다', () => {
  const cases = [
    [{ localRevision: 0, remoteRevision: 5, dirty: true }, 'pull'], // 새 기기·다시 연 브라우저: 빈 데이터로 덮어쓰지 않게
    [{ localRevision: 3, remoteRevision: 5, dirty: false }, 'pull'],
    [{ localRevision: 3, remoteRevision: 5, dirty: true }, 'conflict'],
    [{ localRevision: 5, remoteRevision: 5, dirty: true }, 'push'],
    [{ localRevision: 5, remoteRevision: 5, dirty: false }, 'none'],
  ];
  for (const [input, expected] of cases) assert.equal(decideSync(input), expected, JSON.stringify(input));
});

test('데이터 해시는 내용이 바뀌면 바뀐다', () => {
  const data = createDefaultData(new Date('2026-11-01'));
  const changed = structuredClone(data);
  changed.settings.monthlyLivingCost = 3_000_000;
  assert.equal(hashData(data), hashData(structuredClone(data)));
  assert.notEqual(hashData(data), hashData(changed));
});

test('예전 시트 코드(연동 없음)면 새 코드로 배포하라고 알린다', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ updatedAt: 'x', fx: {}, prices: {}, errors: [] }) });
  await assert.rejects(fetchSyncInfo(URL_, { fetchImpl }), (error) => error.code === 'old-code' && /새 버전/.test(error.message));
});

// ── 두 기기 ─────────────────────────────────────────
function server() {
  const { context } = load([new FakeSheet('시세', 1, [['티커', '가격', '통화']])]);
  return fakeWebAppFetch(context);
}

// 기기 하나: 메모리 저장소 두 개(local·session)와 앱 상태
function device(fetchImpl, { local = createMemoryBackend(), session = createMemoryBackend(), data = createDefaultData() } = {}) {
  const listeners = new Set();
  let current = structuredClone(data);
  let backend = readConfigIsSession(local) ? session : local;
  const loaded = backend.getItem(STORAGE_KEYS.data);
  if (loaded) current = JSON.parse(loaded);
  const save = () => backend.setItem(STORAGE_KEYS.data, JSON.stringify(current));
  const notify = () => listeners.forEach((listener) => listener(current));
  const store = {
    getState: () => current,
    replaceState(next) { current = structuredClone(next); save(); notify(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    switchBackend(next) { backend = next; save(); },
  };
  const engine = createSyncEngine({ ...store, local, session, fetchImpl, autoSync: false, iterations: ITERATIONS });
  return {
    ...store,
    engine,
    local,
    session,
    edit(mutate) { const draft = structuredClone(current); mutate(draft); current = draft; save(); notify(); },
  };
}

function readConfigIsSession(local) {
  try { return JSON.parse(local.getItem(SYNC_KEYS.config) ?? 'null')?.remember === false; } catch { return false; }
}

const holding = (name, quantity) => ({ id: `h-${name}`, name, ticker: `KRX:${name}`, type: 'stock', currency: 'KRW', quantity, avgPrice: 1000, manualPrice: null, account: '일반', assetClass: '성장주', countryMix: { 한국: 100 }, countryPreset: null, sectorMix: { 기술: 100 }, dividendPerShare: null, etfSpread: null, memo: '' });

async function laptopAndCompany() {
  const fetchImpl = server();
  const start = createDefaultData();
  start.holdings = [holding('삼성전자', 10)];
  const laptop = device(fetchImpl, { data: start });
  await laptop.engine.setup({ url: URL_, password: PASSWORD, hint: '첫 강아지', deviceName: '노트북', remember: true });
  const company = device(fetchImpl);
  const pending = await company.engine.prepareJoin({ url: URL_, password: PASSWORD });
  await company.engine.completeJoin(pending, { deviceName: '회사 PC', remember: false });
  return { fetchImpl, laptop, company };
}

test('두 기기: 처음 켜기 → 다른 기기에서 비밀번호로 연결하면 같은 데이터, 비밀번호가 틀리면 연결 안 됨', async () => {
  const fetchImpl = server();
  const start = createDefaultData();
  start.holdings = [holding('삼성전자', 10)];
  const laptop = device(fetchImpl, { data: start });
  await laptop.engine.setup({ url: URL_, password: PASSWORD, hint: '첫 강아지', deviceName: '노트북', remember: true });
  assert.equal(laptop.engine.status.state, 'synced');
  assert.ok(laptop.local.getItem(SYNC_KEYS.key), '기억하기: 키는 localStorage');

  const info = await laptop.engine.info(URL_);
  assert.deepEqual([info.exists, info.hint, info.revision, info.device], [true, '첫 강아지', 1, '노트북']);

  const company = device(fetchImpl);
  await assert.rejects(company.engine.prepareJoin({ url: URL_, password: '틀린 비밀번호' }), (error) => error.code === 'auth');
  const pending = await company.engine.prepareJoin({ url: URL_, password: PASSWORD });
  assert.deepEqual(pending.data.holdings.map((h) => h.name), ['삼성전자']);
  await company.engine.completeJoin(pending, { deviceName: '회사 PC', remember: false });
  assert.deepEqual(company.getState().holdings.map((h) => h.name), ['삼성전자']);
  // 비밀번호를 기억하지 않는 기기: 자산 데이터와 키는 브라우저를 닫으면 사라지는 저장소에만
  assert.equal(company.local.getItem(STORAGE_KEYS.data), null);
  assert.equal(company.local.getItem(SYNC_KEYS.key), null);
  assert.ok(company.session.getItem(STORAGE_KEYS.data));
  assert.ok(company.session.getItem(SYNC_KEYS.key));
  assert.ok(company.local.getItem(SYNC_KEYS.config), '연동 설정(주소·기기 이름)은 남겨 둔다');
});

test('두 기기: 한쪽에서 고치면 저장되고, 다른 쪽에서 맞추면 받아 온다', async () => {
  const { laptop, company } = await laptopAndCompany();
  laptop.edit((draft) => { draft.holdings.push(holding('SK하이닉스', 3)); });
  assert.equal(laptop.engine.isDirty(), true);
  await laptop.engine.sync();
  assert.equal(laptop.engine.status.state, 'synced');
  assert.equal(laptop.engine.status.revision, 2);

  await company.engine.sync();
  assert.equal(company.engine.status.state, 'synced');
  assert.deepEqual(company.getState().holdings.map((h) => h.name), ['삼성전자', 'SK하이닉스']);
  assert.equal(company.engine.isDirty(), false, '받아 온 데이터를 다시 저장하려 하지 않는다');
});

test('두 기기: 양쪽에서 따로 고치면 덮어쓰지 않고 "다른 기기에서 더 최근에 고쳤어요" → 최신 내용 받아오기', async () => {
  const { laptop, company } = await laptopAndCompany();
  laptop.edit((draft) => { draft.holdings[0].quantity = 20; });
  await laptop.engine.sync();
  company.edit((draft) => { draft.settings.monthlyLivingCost = 5_000_000; }); // 회사 PC는 노트북이 고친 걸 모름

  await company.engine.sync();
  assert.equal(company.engine.status.state, 'conflict');
  assert.equal(company.engine.status.remote.device, '노트북');
  assert.equal(company.getState().holdings[0].quantity, 10, '묻기 전에는 바꾸지 않는다');

  await company.engine.resolveConflict('pull');
  assert.equal(company.engine.status.state, 'synced');
  assert.equal(company.getState().holdings[0].quantity, 20);
  assert.equal(company.getState().settings.monthlyLivingCost, createDefaultData().settings.monthlyLivingCost);
});

test('두 기기: 부딪혔을 때 이 기기 내용으로 덮어쓰기도 고를 수 있다', async () => {
  const { laptop, company } = await laptopAndCompany();
  laptop.edit((draft) => { draft.holdings[0].quantity = 20; });
  await laptop.engine.sync();
  company.edit((draft) => { draft.holdings[0].quantity = 99; });
  await company.engine.sync();
  await company.engine.resolveConflict('overwrite');
  assert.equal(company.engine.status.state, 'synced');
  await laptop.engine.sync();
  assert.equal(laptop.getState().holdings[0].quantity, 99);
});

test('저장 기록: 예전 번호로 되돌리면 그 내용을 새 번호로 저장한다', async () => {
  const { laptop, company } = await laptopAndCompany();
  for (const quantity of [11, 12, 13]) {
    laptop.edit((draft) => { draft.holdings[0].quantity = quantity; });
    await laptop.engine.sync();
  }
  const records = await laptop.engine.history();
  assert.deepEqual(records.map((record) => record.revision), [4, 3, 2, 1]);
  await laptop.engine.restore(2);
  assert.equal(laptop.getState().holdings[0].quantity, 11);
  assert.equal(laptop.engine.status.revision, 5);
  await company.engine.sync();
  assert.equal(company.getState().holdings[0].quantity, 11);
});

test('비밀번호를 기억하지 않는 기기: 브라우저를 다시 열면 잠겨 있고, 비밀번호를 넣으면 최신 데이터를 받는다 (빈 데이터로 덮어쓰지 않음)', async () => {
  const { fetchImpl, laptop, company } = await laptopAndCompany();
  // 브라우저를 닫았다가 다시 연 회사 PC: sessionStorage가 비어 있다
  const reopened = device(fetchImpl, { local: company.local, session: createMemoryBackend() });
  assert.equal(reopened.engine.status.state, 'locked');
  assert.deepEqual(reopened.getState().holdings, []);
  await reopened.engine.sync(); // 잠겨 있으면 아무것도 하지 않는다
  await laptop.engine.sync();
  assert.deepEqual(laptop.getState().holdings.map((h) => h.name), ['삼성전자'], '시트의 데이터는 그대로');

  await assert.rejects(reopened.engine.unlock('틀린 비밀번호'), (error) => error.code === 'auth');
  await reopened.engine.unlock(PASSWORD);
  assert.equal(reopened.engine.status.state, 'synced');
  assert.deepEqual(reopened.getState().holdings.map((h) => h.name), ['삼성전자']);
});

test('이 기기에서 데이터 삭제: 두 저장소의 앱 항목(연동 설정·키 포함)을 지우고, 시트와 다른 기기는 그대로', async () => {
  const { laptop, company } = await laptopAndCompany();
  const removed = company.engine.wipeDevice();
  assert.ok(removed >= 3);
  for (const storage of [company.local, company.session]) {
    for (const key of [STORAGE_KEYS.data, SYNC_KEYS.config, SYNC_KEYS.key, SYNC_KEYS.progress]) assert.equal(storage.getItem(key), null, key);
  }
  assert.equal(company.engine.status.state, 'off');
  await laptop.engine.sync();
  assert.equal(laptop.engine.status.state, 'synced');
  assert.deepEqual(laptop.getState().holdings.map((h) => h.name), ['삼성전자']);
});

test('모든 기기에서 지우기: 빈 데이터를 새 번호로 저장하고, 예전 기록에는 남는다', async () => {
  const { laptop, company } = await laptopAndCompany();
  const fresh = createDefaultData();
  await laptop.engine.resetEverywhere(fresh);
  assert.equal(laptop.engine.status.revision, 2);
  await company.engine.sync();
  assert.deepEqual(company.getState().holdings, []);
  assert.deepEqual((await laptop.engine.history()).map((record) => record.revision), [2, 1]);
});

test('이 기기만 연동 끄기: 데이터는 이 기기에 남고(기억하지 않던 기기는 일반 저장소로 옮김), 시트는 그대로', async () => {
  const { laptop, company } = await laptopAndCompany();
  company.engine.disconnect();
  assert.equal(company.engine.status.state, 'off');
  assert.ok(company.local.getItem(STORAGE_KEYS.data));
  assert.equal(company.session.getItem(STORAGE_KEYS.data), null);
  assert.equal(company.local.getItem(SYNC_KEYS.config), null);
  laptop.edit((draft) => { draft.holdings[0].quantity = 1; });
  await laptop.engine.sync();
  assert.equal(laptop.engine.status.state, 'synced');
});
