// 앱 진입점: 데이터 불러오기, 테마 적용, 탭 라우팅(#주소 기반).

import { APP_NAME, STORAGE_KEYS } from './constants.js';
import { STORAGE_PREFIX } from './constants.js';
import { pickStorageBackend } from './storage.js';
import {
  initState, reloadState, getState, updateState, replaceState, subscribe, switchBackend, isPersistEnabled,
} from './state.js';
import { createSyncEngine, dataStorageFor, readSyncConfig } from './sync.js';
import { initMarket, lastFetchedAt, refreshPrices, resetPriceStatus } from './market.js';
import { initInstall } from './install.js';
import { el, clear, closeAllModals, showToast } from './dom.js';
import { mountPriceStatus } from './ui/price-status.js';
import { clearSample, downloadBackup, openGuide } from './ui/data-tools.js';
import { mountSyncBanner, openUnlockModal } from './ui/sync-ui.js';
import * as dashboard from './ui/dashboard.js';
import * as holdings from './ui/holdings.js';
import * as analysis from './ui/analysis.js';
import * as rebalance from './ui/rebalance.js';
import * as forecast from './ui/forecast.js';
import * as others from './ui/others.js';
import * as settings from './ui/settings.js';
import * as guide from './ui/guide.js';

const VIEWS = {
  dashboard: { title: '대시보드', view: dashboard },
  holdings: { title: '보유 종목', view: holdings },
  analysis: { title: '분산 분석', view: analysis },
  rebalance: { title: '리밸런싱', view: rebalance },
  forecast: { title: '미래 예측', view: forecast },
  others: { title: '기타 자산', view: others },
  settings: { title: '설정', view: settings },
  guide: { title: '시트 연결 가이드', view: guide },
};
const DEFAULT_VIEW = 'dashboard';

// 앱을 다시 펼쳤을 때 마지막 시세가 이보다 오래됐으면 새로 받는다.
const PRICE_STALE_MS = 15 * 60 * 1000;
// 기기 연동: 화면을 보고 있는 동안 이 간격으로 다른 기기가 저장했는지 확인한다.
const SYNC_CHECK_MS = 60 * 1000;

const STARTUP_MESSAGES = {
  corrupt: '저장된 데이터를 읽지 못해 새로 시작했어요. 이전 데이터는 브라우저 안에 따로 보관해 두었어요.',
  newer: '더 새로운 버전의 앱에서 저장된 데이터예요. 페이지를 새로고침해 주세요. 지금은 바꾼 내용이 저장되지 않아요.',
  unavailable: '브라우저 저장소를 읽을 수 없어요. 지금은 바꾼 내용이 저장되지 않아요.',
};

let cleanupView = null;

const context = {
  getState,
  updateState,
  subscribe,
  navigate: (viewId) => { window.location.hash = viewId; },
};

function currentViewId() {
  const id = window.location.hash.replace(/^#\/?/, '');
  return Object.hasOwn(VIEWS, id) ? id : null;
}

function renderView(viewId) {
  closeAllModals();
  cleanupView?.();
  cleanupView = null;

  const { title, view } = VIEWS[viewId];
  const main = document.getElementById('view');
  clear(main);
  const body = el('div', { class: 'page-body' });
  main.append(el('header', { class: 'page-head' }, el('h1', { text: title })), body);
  try {
    cleanupView = view.render(body, context) ?? null;
  } catch (error) {
    console.error(error);
    body.append(el('div', { class: 'banner banner-danger', role: 'alert', text: '화면을 그리는 중 문제가 생겼어요. 새로고침해 주세요.' }));
  }

  document.querySelectorAll('[data-tab]').forEach((link) => {
    if (link.dataset.tab === viewId) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.title = viewId === DEFAULT_VIEW ? APP_NAME : `${title} · ${APP_NAME}`;
}

function route() {
  const viewId = currentViewId();
  if (!viewId) {
    window.history.replaceState(null, '', `#${DEFAULT_VIEW}`);
    renderView(DEFAULT_VIEW);
    return;
  }
  renderView(viewId);
  window.scrollTo(0, 0);
}

// ── 테마·손익 색상 ──────────────────────────────────────
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function syncThemeColorMeta() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (bg) meta.setAttribute('content', bg);
}

function applyAppearance({ theme, invertPnlColors }) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  root.dataset.pnl = invertPnlColors ? 'inverted' : 'default';
  syncThemeColorMeta();
}

async function updatePrices(sheetUrl, { quiet = false } = {}) {
  const result = await refreshPrices(sheetUrl);
  if (result.error && !quiet) showToast(`새 시세를 받지 못했어요. ${result.error.message}`, 'danger', 5000);
}

function watchPrices() {
  let sheetUrl = getState().settings.sheetUrl;
  if (sheetUrl) updatePrices(sheetUrl);

  subscribe((state) => {
    if (state.settings.sheetUrl === sheetUrl) return;
    sheetUrl = state.settings.sheetUrl;
    if (sheetUrl) updatePrices(sheetUrl);
    else resetPriceStatus();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !sheetUrl) return;
    const fetchedAt = Date.parse(lastFetchedAt(sheetUrl) ?? '');
    if (!Number.isFinite(fetchedAt) || Date.now() - fetchedAt > PRICE_STALE_MS) updatePrices(sheetUrl, { quiet: true });
  });
}

// 화면 위 안내: 시작할 때 생긴 저장소 문제, 샘플 데이터로 둘러보는 중, 기기 연동(비밀번호 필요·부딪힘·오류)
function mountBanners(startupMessage) {
  const holder = document.getElementById('app-banner');
  if (!holder) return;
  const appSlot = el('div', { class: 'banner-stack' });
  const syncSlot = el('div', { class: 'banner-stack' });
  holder.replaceChildren(appSlot, syncSlot);
  const updateHolder = () => { holder.hidden = appSlot.childElementCount + syncSlot.childElementCount === 0; };
  let sampleShown = null;
  const draw = () => {
    const sample = getState().meta.sample;
    if (sample === sampleShown) return;
    sampleShown = sample;
    const items = [];
    if (startupMessage) items.push(el('div', { class: 'banner banner-warn', role: 'status', text: startupMessage }));
    if (sample) {
      items.push(el('div', { class: 'banner banner-info sample-banner', role: 'status' },
        el('span', { text: '샘플 데이터로 둘러보는 중이에요. 마음껏 바꿔 봐도 돼요.' }),
        el('button', { type: 'button', class: 'btn btn-small', text: '샘플 지우고 내 데이터로 시작', onClick: () => clearSample(context) })));
    }
    appSlot.replaceChildren(...items);
    updateHolder();
  };
  draw();
  subscribe(draw);
  if (context.sync) mountSyncBanner(syncSlot, { sync: context.sync, downloadBackup: () => downloadBackup(context), onChange: updateHolder });
}

// 기기 연동: 앱을 열 때, 다시 볼 때, 인터넷이 다시 연결될 때, 그리고 1분마다 다른 기기와 맞춘다.
function watchSync(sync) {
  const check = () => {
    if (document.visibilityState === 'visible') sync.sync();
  };
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
  window.addEventListener('online', check);
  setInterval(check, SYNC_CHECK_MS);
  if (sync.status.state === 'locked') openUnlockModal({ sync });
  else check();
}

// 브라우저를 닫으면 지워지는 저장소 (기기 연동에서 비밀번호를 기억하지 않는 기기용). 쓸 수 없으면 null
function pickSessionStorage() {
  try {
    const storage = globalThis.sessionStorage;
    const probeKey = `${STORAGE_PREFIX}probe`;
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return null;
  }
}

// 처음 왔고 아직 아무것도 입력하지 않았으면 첫 사용 가이드를 띄운다.
// 기기 연동을 켠 기기(비밀번호를 기억하지 않아 데이터가 비어 있을 수 있음)에서는 띄우지 않는다.
function maybeShowGuide() {
  const state = getState();
  const empty = state.holdings.length + state.otherAssets.length + state.pensions.length === 0;
  if (!state.meta.onboardingDone && empty && isPersistEnabled() && !context.sync?.config) openGuide(context);
}

// 오프라인에서도 열리게 앱 파일을 저장해 두는 서비스 워커 (https 또는 localhost에서만)
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // 등록하지 못해도 앱은 그대로 쓸 수 있다 (오프라인으로만 못 열 뿐).
    });
  });
}

function start() {
  const { backend: local, persistent } = pickStorageBackend();
  const session = pickSessionStorage();
  // 비밀번호를 기억하지 않는 연동 기기면 자산 데이터는 브라우저를 닫으면 지워지는 저장소에 둔다
  const syncConfig = persistent ? readSyncConfig(local) : null;
  const result = initState({
    backend: dataStorageFor(syncConfig, { local, session }),
    onSaveError: () => showToast('저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.', 'danger', 4000),
  });
  context.sync = persistent
    ? createSyncEngine({ getState, replaceState, subscribe, switchBackend, local, session })
    : null;
  mountBanners(persistent
    ? STARTUP_MESSAGES[result.status]
    : '이 브라우저에서는 데이터를 저장할 수 없어요(사생활 보호 모드 등). 창을 닫으면 입력한 내용이 사라져요.');

  applyAppearance(getState().settings);
  subscribe((state) => applyAppearance(state.settings));
  darkQuery.addEventListener('change', syncThemeColorMeta);

  initMarket(local);
  mountPriceStatus(document.getElementById('price-status'), { getState, subscribe });
  watchPrices();

  window.addEventListener('hashchange', route);
  // 다른 탭에서 저장하면 이 탭도 최신 데이터로 다시 그린다.
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEYS.data) return;
    reloadState();
    renderView(currentViewId() ?? DEFAULT_VIEW);
  });

  initInstall();
  route();
  maybeShowGuide();
  if (context.sync) watchSync(context.sync);
  registerServiceWorker();
}

start();
