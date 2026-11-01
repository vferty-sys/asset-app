// 서비스 워커: 앱 파일을 저장해 두었다가 인터넷이 끊겨도 앱이 열리게 한다.
//  - 앱 파일(같은 주소): 인터넷이 되면 늘 새 파일을 먼저 받고(네트워크 우선), 안 되면 저장해 둔 사본을 쓴다.
//    그래서 GitHub에 새 버전을 올리면 다음에 열 때 바로 새 화면이 나온다. 개인 데이터(LocalStorage)는 건드리지 않는다.
//  - Chart.js(CDN): 버전이 고정된 파일이라 한 번 받으면 사본을 쓴다.
//  - 구글 시트 시세 요청 등 다른 주소: 서비스 워커가 관여하지 않는다 (저장하지도 않음).
// 파일을 추가·삭제·이름 변경했으면 APP_FILES를 고치고 CACHE_VERSION을 올려 주세요. (tests/sw.test.js가 목록을 검사한다)

const CACHE_VERSION = 'v5';
const CACHE_PREFIX = 'asset-app-';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const CHART_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js';

const APP_FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/base.css',
  './css/components.css',
  './css/layout.css',
  './css/views.css',
  './js/app.js',
  './js/calc/allocation-presets.js',
  './js/calc/csv.js',
  './js/calc/diversification.js',
  './js/calc/projection.js',
  './js/calc/rebalance.js',
  './js/calc/score.js',
  './js/calc/tax.js',
  './js/calc/totals.js',
  './js/calc/valuation.js',
  './js/charts.js',
  './js/classify.js',
  './js/constants.js',
  './js/country-weights.js',
  './js/dates.js',
  './js/dom.js',
  './js/format.js',
  './js/holding.js',
  './js/id.js',
  './js/install.js',
  './js/markdown.js',
  './js/market.js',
  './js/other-asset.js',
  './js/pension.js',
  './js/price.js',
  './js/sample-data.js',
  './js/snapshot.js',
  './js/state.js',
  './js/stock-list.js',
  './js/storage.js',
  './js/sync.js',
  './js/ui/allocation-picker.js',
  './js/ui/analysis.js',
  './js/ui/dashboard.js',
  './js/ui/data-tools.js',
  './js/ui/forecast.js',
  './js/ui/form.js',
  './js/ui/guide.js',
  './js/ui/holding-form.js',
  './js/ui/holdings-csv.js',
  './js/ui/holdings.js',
  './js/ui/onboarding.js',
  './js/ui/other-asset-form.js',
  './js/ui/others.js',
  './js/ui/pension-form.js',
  './js/ui/price-status.js',
  './js/ui/rebalance.js',
  './js/ui/score-view.js',
  './js/ui/settings.js',
  './js/ui/stock-picker.js',
  './js/ui/sync-ui.js',
  './js/validate.js',
  './data/stocks.json',
  './docs/SHEET_SETUP.md',
  './apps-script/Code.gs',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon-maskable.svg',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_FILES.map((file) => new Request(file, { cache: 'no-cache' })));
    // 차트 도구는 받을 수 있을 때만 미리 받아 둔다 (못 받아도 설치는 계속)
    await cache.add(new Request(CHART_URL, { mode: 'cors' })).catch(() => {});
    await self.skipWaiting();
  })());
});

// 예전 버전의 사본을 지우고 바로 이 버전으로 바꾼다.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (request.url === CHART_URL) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    // 브라우저 캐시를 거치지 않고 서버에 새 파일이 있는지 확인한다 (바뀌지 않았으면 짧은 304 응답)
    const response = await fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' });
    if (response.ok) await cache.put(request.url, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request.url, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}
