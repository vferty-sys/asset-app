// 데이터 관리 (요청서 5-7, 8-2): 백업 내려받기·복원, 샘플 데이터, 첫 사용 가이드, 초기화, 이 기기에서 데이터 삭제,
// 그리고 홈 화면에 설치(PWA) 안내

import { createBackup, createDefaultData, parseBackup } from '../storage.js';
import { clearAllData, replaceState } from '../state.js';
import { createSampleData } from '../sample-data.js';
import { todayString } from '../dates.js';
import { canPromptInstall, isStandalone, promptInstall, subscribeInstall } from '../install.js';
import { el, closeAllModals, confirmDialog, openModal, showToast, uid } from '../dom.js';
import { formatDate } from '../format.js';
import { openOnboarding } from './onboarding.js';

// .gitignore의 *backup*.json, asset-app-*.json 규칙과 맞춘 파일 이름
const BACKUP_FILE_PREFIX = 'asset-app-backup-';
const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

function hasData(state) {
  return state.holdings.length + state.otherAssets.length + state.pensions.length + state.snapshots.length > 0;
}

function describe(data) {
  return `보유 종목 ${data.holdings.length}개, 공제회·예적금 ${data.otherAssets.length}개, 연금 ${data.pensions.length}개, 월별 기록 ${data.snapshots.length}개`;
}

function download(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = el('a', { href: url, download: filename, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function freshData() {
  const data = createDefaultData();
  data.meta.onboardingDone = true;
  return data;
}

// 백업 파일 내려받기 (내 데이터 칸과 기기 연동의 '이 기기 내용 백업 받기'가 함께 쓴다)
export function downloadBackup({ getState, updateState }) {
  download(createBackup(getState()), `${BACKUP_FILE_PREFIX}${todayString()}.json`);
  updateState((draft) => { draft.meta.lastBackupAt = todayString(); });
  showToast('백업 파일을 내려받았어요');
}

// 기기 연동 중에 '모든 데이터 초기화'를 누르면 어디까지 지울지 묻는다: 'device' | 'all' | null
function chooseResetScope() {
  return new Promise((resolve) => {
    let choice = null;
    const pick = (value) => () => {
      choice = value;
      close();
    };
    const cancel = el('button', { type: 'button', class: 'btn', text: '취소' });
    const device = el('button', { type: 'button', class: 'btn btn-danger', text: '이 기기만 초기화' });
    const all = el('button', { type: 'button', class: 'btn btn-danger-solid', text: '모든 기기에서 지우기' });
    const { close } = openModal({
      title: '모든 데이터 초기화',
      size: 'sm',
      body: el('div', { class: 'form' },
        el('p', { text: '기기 연동 중이에요. 어디까지 지울까요?' }),
        el('ul', { class: 'reset-scope' },
          el('li', {}, el('strong', { text: '이 기기만 초기화: ' }), '이 기기의 데이터를 지우고 연동을 꺼요. 시트와 다른 기기의 데이터는 그대로예요.'),
          el('li', {}, el('strong', { text: '모든 기기에서 지우기: ' }), '모든 기기의 자산 데이터를 비워요. 지우기 전 내용은 저장 기록에 남아서 되돌릴 수 있어요.'))),
      footer: [cancel, el('span', { class: 'spacer' }), device, all],
      onClose: () => resolve(choice),
    });
    cancel.addEventListener('click', pick(null));
    device.addEventListener('click', pick('device'));
    all.addEventListener('click', pick('all'));
  });
}

// 샘플 데이터 불러오기. 내 데이터가 있으면 먼저 묻는다.
export async function loadSample({ getState, navigate, sync }) {
  const state = getState();
  if ((hasData(state) && !state.meta.sample) || sync?.config) {
    const synced = sync?.config ? ' 기기 연동 중이라 다른 기기의 데이터도 샘플로 바뀌어요 (저장 기록에서 되돌릴 수 있어요).' : '';
    const confirmed = await confirmDialog({
      title: '샘플 데이터 불러오기',
      message: `지금 입력한 데이터(${describe(state)})가 모두 샘플로 바뀌어요. 필요하면 먼저 백업 파일을 내려받으세요.${synced}`,
      confirmText: '샘플로 바꾸기',
      danger: true,
    });
    if (!confirmed) return;
  }
  replaceState(createSampleData());
  showToast('샘플 데이터를 불러왔어요');
  navigate('dashboard');
}

// 샘플을 지우고 빈 상태로 시작
export async function clearSample({ navigate }) {
  const confirmed = await confirmDialog({
    title: '내 데이터로 시작하기',
    message: '샘플 데이터를 모두 지우고 빈 상태로 시작할까요? 샘플에서 바꾼 내용도 함께 지워져요.',
    confirmText: '샘플 지우기',
  });
  if (!confirmed) return;
  replaceState(freshData());
  showToast('샘플을 지웠어요. 이제 내 자산을 입력해 보세요');
  navigate('dashboard');
}

// 첫 사용 가이드. 어떻게 닫든 다시 저절로 뜨지 않게 표시해 둔다.
export function openGuide({ getState, updateState, navigate }) {
  openOnboarding({
    onSample: () => loadSample({ getState, navigate }),
    onClose: () => {
      if (!getState().meta.onboardingDone) updateState((draft) => { draft.meta.onboardingDone = true; });
    },
  });
}

// 데이터를 지운 뒤: 앱 화면을 가리고 새로 시작하는 버튼만 남긴다 (공용 PC에서 다음 사람이 보지 못하게)
function showWipedScreen(removed) {
  closeAllModals();
  const titleId = uid('wiped-title');
  const restart = el('button', {
    type: 'button',
    class: 'btn btn-primary',
    text: '처음부터 다시 시작',
    onClick: () => {
      window.location.hash = 'dashboard';
      window.location.reload();
    },
  });
  const app = document.querySelector('.app');
  if (app) app.inert = true;
  document.body.append(el('div', { class: 'wiped-screen', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    el('div', { class: 'card wiped-card' },
      el('h2', { class: 'section-title', id: titleId, text: '이 기기에서 데이터를 지웠어요' }),
      el('p', { text: `이 브라우저에 남아 있던 이 앱의 저장 항목 ${removed}개를 모두 지웠어요.` }),
      el('p', { class: 'muted', text: '이제 이 창(탭)을 닫아도 돼요. 다시 쓰려면 아래 버튼을 누르세요.' }),
      restart)));
  restart.focus();
}

export function dataSection({ getState, updateState, navigate, sync }) {
  const result = el('div', { class: 'data-result', role: 'status', hidden: true });
  const showResult = (tone, text) => {
    result.className = `data-result banner banner-${tone}`;
    result.textContent = text;
    result.hidden = false;
  };
  const lastBackup = el('p', { class: 'muted small' });
  const refreshLastBackup = () => {
    const at = getState().meta.lastBackupAt;
    lastBackup.textContent = at ? `마지막으로 내려받은 백업: ${formatDate(at)}` : '아직 백업 파일을 내려받은 적이 없어요.';
  };
  refreshLastBackup();

  // ── 백업 내려받기 ──
  const backupButton = el('button', {
    type: 'button',
    class: 'btn btn-primary',
    text: '백업 파일 내려받기',
    onClick: () => {
      downloadBackup({ getState, updateState });
      refreshLastBackup();
      result.hidden = true;
    },
  });

  // ── 복원 ──
  const fileInput = el('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
  const restoreButton = el('button', {
    type: 'button',
    class: 'btn',
    text: '백업 파일로 복원',
    onClick: () => {
      fileInput.value = '';
      fileInput.click();
    },
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      showResult('danger', '파일이 너무 커요. 이 앱에서 내려받은 백업 파일인지 확인해 주세요.');
      return;
    }
    let text;
    let data;
    try {
      text = await file.text();
      data = parseBackup(text);
    } catch (error) {
      showResult('danger', error?.name === 'DataError' ? error.message : '파일을 읽지 못했어요. 이 앱에서 내려받은 백업 파일인지 확인해 주세요.');
      return;
    }
    let exportedAt = null;
    try {
      exportedAt = JSON.parse(text).exportedAt ?? null;
    } catch {
      // 날짜를 몰라도 복원은 할 수 있다.
    }
    const confirmed = await confirmDialog({
      title: '백업 파일로 복원',
      message: `${exportedAt ? `${formatDate(exportedAt)}에 내려받은 ` : ''}백업(${describe(data)})으로 바꿀까요? 지금 이 기기의 데이터는 지워져요.${sync?.config ? ' 기기 연동 중이라 다른 기기에도 반영돼요.' : ''}`,
      confirmText: '복원하기',
      danger: true,
    });
    if (!confirmed) return;
    replaceState({ ...data, meta: { ...data.meta, onboardingDone: true } });
    showToast('복원했어요');
    navigate('dashboard');
  });

  // ── 초기화·삭제 ──
  const resetButton = el('button', {
    type: 'button',
    class: 'btn btn-danger',
    text: '모든 데이터 초기화',
    onClick: async () => {
      if (sync?.config) {
        const scope = await chooseResetScope();
        if (scope === 'device') {
          sync.wipeDevice();
          clearAllData();
          window.location.hash = 'dashboard';
          window.location.reload();
        } else if (scope === 'all') {
          // 시트 주소는 남겨 둔다 (모든 기기의 시세 연결이 끊기지 않게)
          const fresh = freshData();
          fresh.settings.sheetUrl = getState().settings.sheetUrl;
          const status = await sync.resetEverywhere(fresh);
          if (status.state === 'synced') showToast('모든 기기에서 지웠어요. 저장 기록에서 되돌릴 수 있어요');
          else showResult('danger', status.message ?? '지우지 못했어요. "지금 맞추기"를 한 뒤 다시 해 주세요.');
        }
        return;
      }
      const confirmed = await confirmDialog({
        title: '모든 데이터 초기화',
        message: '보유 종목, 공제회·예적금, 연금, 목표 비중, 월별 기록, 설정(시트 주소 포함)을 모두 지우고 처음 상태로 돌아가요. 되돌릴 수 없으니 필요하면 먼저 백업 파일을 내려받으세요.',
        confirmText: '모두 지우기',
        danger: true,
      });
      if (!confirmed) return;
      clearAllData();
      window.location.hash = 'dashboard';
      window.location.reload();
    },
  });
  const wipeButton = el('button', {
    type: 'button',
    class: 'btn btn-danger',
    text: '이 기기에서 데이터 삭제',
    onClick: async () => {
      const synced = Boolean(sync?.config);
      const confirmed = await confirmDialog({
        title: '이 기기에서 데이터 삭제',
        message: synced
          ? '이 브라우저에 저장된 이 앱의 데이터(자산·설정·시트 주소·시세 기록)와 기기 연동 설정·비밀번호를 모두 지워요. 구글 시트에 저장된 연동 데이터와 다른 기기는 그대로라, 나중에 이 기기에서 다시 연결하면 받아 올 수 있어요.'
          : '이 브라우저에 저장된 이 앱의 데이터(자산·설정·시트 주소·시세 기록·복구용 사본)를 모두 지워요. 지운 뒤에는 되돌릴 수 없어요. 계속 쓸 거라면 먼저 백업 파일을 내려받으세요.',
        confirmText: '삭제하기',
        danger: true,
      });
      if (!confirmed) return;
      const removed = (sync ? sync.wipeDevice() : 0) + clearAllData();
      showWipedScreen(removed);
    },
  });

  return el('section', { class: 'card settings-section data-section', 'aria-label': '내 데이터' },
    el('h2', { class: 'section-title', text: '내 데이터' }),
    el('p', {
      class: 'section-desc',
      text: sync?.config
        ? '입력한 정보는 이 기기의 브라우저에 저장되고, 기기 연동으로 연동 비밀번호로 잠근 사본이 내 구글 시트에도 저장돼요. 그 밖의 곳으로는 전송되지 않아요.'
        : '입력한 정보는 이 기기의 브라우저에만 저장되고, 어디로도 전송되지 않아요. 같은 앱 주소를 다른 사람이 써도 데이터가 섞이지 않아요.',
    }),
    el('div', { class: 'data-block' },
      el('h3', { class: 'data-title', text: '백업과 복원' }),
      el('p', { text: '다른 기기나 브라우저로 옮길 때, 그리고 브라우저 기록을 지울 때를 대비해 백업 파일을 내려받아 두세요. 새 기기에서 이 화면의 "백업 파일로 복원"을 누르면 그대로 옮겨져요.' }),
      lastBackup,
      el('div', { class: 'toolbar' }, backupButton, restoreButton, fileInput),
      result,
      el('p', { class: 'muted small', text: '백업 파일에는 자산 정보와 시트 주소가 들어 있어요. 다른 사람에게 보내거나 GitHub 같은 공개된 곳에 올리지 마세요.' })),
    el('div', { class: 'data-block' },
      el('h3', { class: 'data-title', text: '둘러보기' }),
      el('div', { class: 'toolbar' },
        el('button', { type: 'button', class: 'btn', text: '사용 가이드 다시 보기', onClick: () => openGuide({ getState, updateState, navigate }) }),
        el('button', { type: 'button', class: 'btn', text: '샘플 데이터 불러오기', onClick: () => loadSample({ getState, navigate, sync }) }))),
    el('div', { class: 'data-block danger-zone' },
      el('h3', { class: 'data-title', text: '데이터 지우기' }),
      el('p', { text: '여러 사람이 쓰는 컴퓨터(회사·학교·PC방 등)에서는 다 쓴 뒤 "이 기기에서 데이터 삭제"를 눌러 주세요. 데이터가 이 브라우저에 남아 있어서, 다음 사람이 이 주소를 열면 볼 수 있어요. 기기 연동 중이면 시트와 다른 기기의 데이터는 그대로예요.' }),
      el('div', { class: 'toolbar' }, resetButton, wipeButton)));
}

// 홈 화면에 설치 안내. 돌려주는 cleanup으로 구독을 끊는다.
export function installSection() {
  const status = el('div', { class: 'install-status' });
  const draw = () => {
    if (isStandalone()) {
      status.replaceChildren(el('p', { class: 'alert-clear' }, el('span', { class: 'badge badge-ok', text: '설치됨' }), ' 홈 화면에 설치한 앱으로 쓰고 있어요.'));
      return;
    }
    status.replaceChildren(canPromptInstall()
      ? el('button', {
        type: 'button',
        class: 'btn btn-primary',
        text: '앱 설치하기',
        onClick: async () => {
          if (await promptInstall()) showToast('설치했어요. 홈 화면에서 열 수 있어요');
        },
      })
      : el('p', { class: 'muted small', text: '이 브라우저는 설치 버튼을 지원하지 않아요. 아래 방법으로 추가해 주세요.' }));
  };
  draw();
  const unsubscribe = subscribeInstall(draw);
  const element = el('section', { class: 'card settings-section', 'aria-label': '홈 화면에 추가' },
    el('h2', { class: 'section-title', text: '홈 화면에 추가' }),
    el('p', { class: 'section-desc', text: '휴대폰 홈 화면에 추가하면 앱처럼 바로 열 수 있고, 인터넷이 잠깐 끊겨도 마지막으로 열었던 화면을 볼 수 있어요.' }),
    status,
    el('ul', { class: 'install-steps' },
      el('li', { text: '아이폰(사파리): 아래쪽 공유 버튼 → "홈 화면에 추가"' }),
      el('li', { text: '안드로이드(크롬): 오른쪽 위 ⋮ 메뉴 → "홈 화면에 추가" 또는 "앱 설치"' })));
  return { element, cleanup: unsubscribe };
}
