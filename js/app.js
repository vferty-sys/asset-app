// 앱 진입점: 데이터 불러오기, 테마 적용, 탭 라우팅(#주소 기반).

import { APP_NAME, STORAGE_KEYS } from './constants.js';
import { pickStorageBackend } from './storage.js';
import { initState, reloadState, getState, updateState, subscribe } from './state.js';
import { initMarket, lastFetchedAt, refreshPrices, resetPriceStatus } from './market.js';
import { el, clear, closeAllModals, showToast } from './dom.js';
import { mountPriceStatus } from './ui/price-status.js';
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

function showStartupBanner(status, persistent) {
  const message = persistent ? STARTUP_MESSAGES[status] : '이 브라우저에서는 데이터를 저장할 수 없어요(사생활 보호 모드 등). 창을 닫으면 입력한 내용이 사라져요.';
  const holder = document.getElementById('app-banner');
  if (!message || !holder) return;
  holder.replaceChildren(el('div', { class: 'banner banner-warn', role: 'status', text: message }));
  holder.hidden = false;
}

function start() {
  const { backend, persistent } = pickStorageBackend();
  const result = initState({
    backend,
    onSaveError: () => showToast('저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.', 'danger', 4000),
  });
  showStartupBanner(result.status, persistent);

  applyAppearance(getState().settings);
  subscribe((state) => applyAppearance(state.settings));
  darkQuery.addEventListener('change', syncThemeColorMeta);

  initMarket(backend);
  mountPriceStatus(document.getElementById('price-status'), { getState, subscribe });
  watchPrices();

  window.addEventListener('hashchange', route);
  // 다른 탭에서 저장하면 이 탭도 최신 데이터로 다시 그린다.
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEYS.data) return;
    reloadState();
    renderView(currentViewId() ?? DEFAULT_VIEW);
  });

  route();
}

start();
