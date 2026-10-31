// 휴대폰·PC에 앱처럼 설치하기(PWA). 브라우저가 설치를 제안할 수 있으면(beforeinstallprompt) 그 이벤트를
// 받아 두었다가 설정 화면의 '앱 설치하기' 버튼으로 띄운다. 아이폰 사파리는 이 기능이 없어 안내 문구로 대신한다.

let deferredPrompt = null;
const listeners = new Set();

function notify() {
  for (const listener of [...listeners]) listener();
}

export function initInstall() {
  window.addEventListener('beforeinstallprompt', (event) => {
    deferredPrompt = event;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

export function canPromptInstall() {
  return deferredPrompt != null;
}

// 설치 창을 띄운다. 설치했으면 true
export async function promptInstall() {
  const event = deferredPrompt;
  if (!event) return false;
  deferredPrompt = null;
  notify();
  event.prompt();
  const choice = await event.userChoice;
  return choice?.outcome === 'accepted';
}

// 홈 화면에 설치한 앱으로 열었는지
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function subscribeInstall(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
