// 기기 연동 화면: 설정의 '기기 연동' 칸, 켜기·연결·비밀번호 입력 창, 다른 기기와 부딪혔을 때 묻는 창, 저장 기록,
// 그리고 화면 위 안내(비밀번호 필요·부딪힘·오류). 연동 로직은 ../sync.js
import { PASSWORD_MIN_LENGTH, guessDeviceName } from '../sync.js';
import { el, confirmDialog, openModal, showToast } from '../dom.js';
import { createField, createToggleField, textInput } from './form.js';

const REMEMBER_HINT = '회사·공용 PC에서는 끄세요. 끄면 브라우저를 닫을 때 이 기기의 데이터와 비밀번호가 지워지고, 다시 열면 비밀번호를 물어봐요.';
const FORGET_WARNING = '비밀번호를 잊으면 시트에 저장된 데이터를 풀 수 없어요. 각 기기에 있는 데이터와 백업 파일은 그대로 남아요.';

// '11월 1일 14:32'
export function formatSavedAt(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${time}`;
}

function describe(data) {
  return `보유 종목 ${data.holdings.length}개, 공제회·예적금 ${data.otherAssets.length}개, 연금 ${data.pensions.length}개`;
}

const hasData = (data) => data.holdings.length + data.otherAssets.length + data.pensions.length + data.snapshots.length > 0;

function passwordInput(autocomplete) {
  const input = textInput({ type: 'password', maxlength: 100 });
  input.setAttribute('autocomplete', autocomplete);
  return input;
}

// 창 안의 진행·오류 문구
function messageLine() {
  const node = el('p', { class: 'sync-message', role: 'status', hidden: true });
  return {
    node,
    show(tone, text) {
      node.className = `sync-message banner banner-${tone}`;
      node.textContent = text;
      node.hidden = false;
    },
    hide() { node.hidden = true; },
  };
}

function deviceFields(deviceName = guessDeviceName(), remember = true) {
  const device = createField({ label: '이 기기 이름', hint: '저장 기록과 알림에 "회사 PC에서 저장"처럼 보여요.', control: textInput({ value: deviceName, maxlength: 30 }) });
  const rememberToggle = createToggleField({ label: '이 기기에 비밀번호 기억하기', hint: REMEMBER_HINT, checked: remember });
  return { device, rememberToggle };
}

// ── 처음 켜는 기기 ──────────────────────────────────
function openSetupModal({ sync, getState, url, onJoin }) {
  const password = createField({ label: '연동 비밀번호', hint: `${PASSWORD_MIN_LENGTH}자 이상. 구글 계정 비밀번호와 다르게 정해 주세요.`, control: passwordInput('new-password') });
  const confirm = createField({ label: '비밀번호 한 번 더', control: passwordInput('new-password') });
  const hint = createField({ label: '비밀번호 힌트 (선택)', hint: '웹 앱 주소를 아는 사람도 볼 수 있어요. 나만 알아볼 수 있게 적어 주세요.', control: textInput({ maxlength: 100 }) });
  const { device, rememberToggle } = deviceFields();
  const message = messageLine();
  const submit = el('button', { type: 'submit', class: 'btn btn-primary', text: '연동 켜기' });
  const cancel = el('button', { type: 'button', class: 'btn', text: '취소' });
  const form = el('form', { class: 'form', novalidate: true },
    el('p', { text: `이 기기의 지금 데이터(${describe(getState())})를 첫 데이터로 내 구글 시트에 저장해요. 다른 기기에서는 같은 비밀번호로 연결하면 돼요.` }),
    password.element, confirm.element, hint.element, device.element, rememberToggle.element,
    el('p', { class: 'banner banner-warn', text: FORGET_WARNING }),
    message.node);
  form.id = 'sync-setup-form';
  submit.setAttribute('form', form.id);
  const { close } = openModal({ title: '기기 연동 켜기', body: form, footer: [el('span', { class: 'spacer' }), cancel, submit] });
  cancel.addEventListener('click', close);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = password.control.value;
    password.setError(value.length < PASSWORD_MIN_LENGTH ? `${PASSWORD_MIN_LENGTH}자 이상으로 정해 주세요.` : null);
    confirm.setError(value !== confirm.control.value ? '두 비밀번호가 달라요.' : null);
    if (value.length < PASSWORD_MIN_LENGTH || value !== confirm.control.value) return;
    submit.disabled = true;
    message.show('info', '비밀번호로 잠가서 시트에 저장하는 중…');
    try {
      await sync.setup({
        url, password: value, hint: hint.control.value.trim(), deviceName: device.control.value.trim() || guessDeviceName(), remember: rememberToggle.control.checked,
      });
      close();
      showToast('기기 연동을 켰어요. 다른 기기에서 같은 비밀번호로 연결하세요');
    } catch (error) {
      if (error.code === 'exists') {
        close();
        onJoin();
        return;
      }
      message.show('danger', error.message);
      submit.disabled = false;
    }
  });
}

// ── 이미 켜진 연동에 연결하는 기기 ──────────────────────
function openJoinModal({ sync, getState, url, info }) {
  const password = createField({ label: '연동 비밀번호', control: passwordInput('current-password') });
  const { device, rememberToggle } = deviceFields();
  const message = messageLine();
  const submit = el('button', { type: 'submit', class: 'btn btn-primary', text: '연결하기' });
  const cancel = el('button', { type: 'button', class: 'btn', text: '취소' });
  const form = el('form', { class: 'form', novalidate: true },
    el('p', { text: `${info.device || '다른 기기'}에서 켠 연동이 있어요. 그때 정한 비밀번호를 입력하면 시트의 데이터를 이 기기로 받아 와요.` }),
    info.hint ? el('p', { class: 'sync-hint' }, el('strong', { text: '비밀번호 힌트: ' }), el('span', { text: info.hint })) : null,
    password.element, device.element, rememberToggle.element, message.node);
  form.id = 'sync-join-form';
  submit.setAttribute('form', form.id);
  const { close } = openModal({ title: '기기 연동 연결', body: form, footer: [el('span', { class: 'spacer' }), cancel, submit] });
  cancel.addEventListener('click', close);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!password.control.value) {
      password.setError('비밀번호를 입력해 주세요.');
      return;
    }
    password.setError(null);
    submit.disabled = true;
    message.show('info', '비밀번호를 확인하고 데이터를 받는 중…');
    try {
      const pending = await sync.prepareJoin({ url, password: password.control.value });
      const current = getState();
      if (hasData(current) && !current.meta.sample) {
        const confirmed = await confirmDialog({
          title: '이 기기의 데이터 바꾸기',
          message: `이 기기에 있던 데이터(${describe(current)})가 시트의 데이터(${describe(pending.data)})로 바뀌어요. 이 기기의 데이터가 필요하면 취소하고 먼저 백업 파일을 내려받으세요.`,
          confirmText: '시트의 데이터로 바꾸기',
          danger: true,
        });
        if (!confirmed) {
          message.hide();
          submit.disabled = false;
          return;
        }
      }
      await sync.completeJoin(pending, { deviceName: device.control.value.trim() || guessDeviceName(), remember: rememberToggle.control.checked });
      close();
      showToast('연결했어요. 이제 다른 기기와 같은 데이터를 써요');
    } catch (error) {
      message.show('danger', error.message);
      submit.disabled = false;
    }
  });
}

// 연동 켜기 버튼: 시트에 연동이 있는지 보고 처음 켜기/연결하기 창을 연다
async function startSync({ sync, getState, url, report }) {
  report('info', '시트를 확인하는 중…');
  try {
    const info = await sync.info(url);
    report(null);
    const join = async () => openJoinModal({ sync, getState, url, info: await sync.info(url) });
    if (info.exists) openJoinModal({ sync, getState, url, info });
    else openSetupModal({ sync, getState, url, onJoin: join });
  } catch (error) {
    report('danger', error.message);
  }
}

// ── 비밀번호를 기억하지 않는 기기에서 다시 열었을 때 ─────────
let unlockOpen = false;
export async function openUnlockModal({ sync }) {
  if (unlockOpen || !sync.config) return;
  unlockOpen = true;
  const password = createField({ label: '연동 비밀번호', control: passwordInput('current-password') });
  const hintLine = el('p', { class: 'sync-hint', hidden: true });
  const message = messageLine();
  const submit = el('button', { type: 'submit', class: 'btn btn-primary', text: '데이터 받아오기' });
  const later = el('button', { type: 'button', class: 'btn', text: '나중에' });
  const form = el('form', { class: 'form', novalidate: true },
    el('p', { text: sync.status.message ?? `${sync.config.deviceName}은(는) 비밀번호를 기억하지 않는 기기예요. 비밀번호를 입력하면 최신 데이터를 받아 와요.` }),
    hintLine, password.element, message.node);
  form.id = 'sync-unlock-form';
  submit.setAttribute('form', form.id);
  const { close } = openModal({
    title: '기기 연동 비밀번호', body: form, footer: [el('span', { class: 'spacer' }), later, submit], size: 'sm', onClose: () => { unlockOpen = false; },
  });
  later.addEventListener('click', close);
  sync.info(sync.config.url).then((info) => {
    if (!info.hint) return;
    hintLine.replaceChildren(el('strong', { text: '비밀번호 힌트: ' }), el('span', { text: info.hint }));
    hintLine.hidden = false;
  }).catch(() => {});

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    message.show('info', '비밀번호를 확인하는 중…');
    try {
      const status = await sync.unlock(password.control.value);
      close();
      if (status.state === 'synced') showToast('최신 데이터를 받아왔어요');
    } catch (error) {
      message.show('danger', error.message);
      submit.disabled = false;
    }
  });
}

// ── 다른 기기에서 더 최근에 고쳤을 때 ───────────────────
let conflictOpen = false;
export function openConflictModal({ sync, downloadBackup }) {
  if (conflictOpen || !sync.conflict) return;
  conflictOpen = true;
  const remote = sync.conflict;
  const message = messageLine();
  const pull = el('button', { type: 'button', class: 'btn btn-primary', text: '최신 내용 받아오기' });
  const backup = el('button', { type: 'button', class: 'btn', text: '이 기기 내용 백업 받기' });
  const overwrite = el('button', { type: 'button', class: 'btn btn-danger', text: '이 기기 내용으로 덮어쓰기' });
  const body = el('div', { class: 'form' },
    el('p', { text: `${remote.device || '다른 기기'}에서 ${formatSavedAt(remote.savedAt)}에 저장한 내용이 있어요. 이 기기에서 고친 내용과 한꺼번에 저장할 수 없어서, 최신 내용을 먼저 받아 올게요.` }),
    el('p', { class: 'muted small', text: '받아 오면 이 기기에서 저장하지 못한 변경은 사라져요. 필요하면 먼저 "이 기기 내용 백업 받기"로 내려받아 두고, 받아 온 뒤 다시 입력해 주세요.' }),
    el('div', { class: 'toolbar' }, backup, overwrite),
    message.node);
  const { close } = openModal({
    title: '다른 기기에서 더 최근에 고쳤어요', body, footer: [el('span', { class: 'spacer' }), pull], onClose: () => { conflictOpen = false; },
  });
  backup.addEventListener('click', () => downloadBackup());
  const finish = (status, text) => {
    if (status.state === 'synced') {
      close();
      showToast(text);
    } else {
      message.show('danger', status.message ?? '맞추지 못했어요. 잠시 뒤 다시 시도해 주세요.');
      pull.disabled = false;
      overwrite.disabled = false;
    }
  };
  pull.addEventListener('click', async () => {
    pull.disabled = true;
    message.show('info', '최신 내용을 받는 중…');
    finish(await sync.resolveConflict('pull'), '최신 내용을 받아왔어요');
  });
  overwrite.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: '이 기기 내용으로 덮어쓰기',
      message: `${remote.device || '다른 기기'}에서 저장한 내용 대신 이 기기의 내용을 저장할까요? 덮어쓴 내용은 저장 기록에 남아서 나중에 되돌릴 수 있어요.`,
      confirmText: '덮어쓰기',
      danger: true,
    });
    if (!confirmed) return;
    overwrite.disabled = true;
    pull.disabled = true;
    message.show('info', '저장하는 중…');
    finish(await sync.resolveConflict('overwrite'), '이 기기 내용으로 저장했어요');
  });
}

// ── 저장 기록 (되돌리기) ──────────────────────────────
async function openHistoryModal({ sync }) {
  const list = el('ul', { class: 'sync-history' }, el('li', { class: 'muted', text: '불러오는 중…' }));
  const message = messageLine();
  const { close } = openModal({
    title: '저장 기록',
    body: el('div', { class: 'form' },
      el('p', { class: 'muted small', text: '최근 저장 11개(지금 + 예전 10개)를 남겨 둬요. 되돌리면 그 내용을 새로 저장하고, 지금 내용도 기록에 남아요.' }),
      list, message.node),
    footer: [el('span', { class: 'spacer' }), el('button', { type: 'button', class: 'btn', text: '닫기', onClick: () => close() })],
  });
  let records;
  try {
    records = await sync.history();
  } catch (error) {
    list.replaceChildren();
    message.show('danger', error.message);
    return;
  }
  list.replaceChildren(...records.map((record, index) => {
    const label = `${formatSavedAt(record.savedAt)} · ${record.device || '기기'}`;
    const action = index === 0
      ? el('span', { class: 'badge badge-ok badge-tiny', text: '지금' })
      : el('button', {
        type: 'button',
        class: 'btn btn-small',
        text: '되돌리기',
        onClick: async () => {
          const confirmed = await confirmDialog({
            title: '이 기록으로 되돌리기',
            message: `${label}에 저장한 내용으로 되돌릴까요? 모든 기기에 반영되고, 지금 내용도 기록에 남아서 다시 되돌릴 수 있어요.`,
            confirmText: '되돌리기',
          });
          if (!confirmed) return;
          message.show('info', '되돌리는 중…');
          const status = await sync.restore(record.revision);
          if (status.state === 'synced') {
            close();
            showToast('되돌렸어요');
          } else {
            message.show('danger', status.message ?? '되돌리지 못했어요. 먼저 "지금 맞추기"를 해 주세요.');
          }
        },
      });
    return el('li', { class: 'sync-history-row' },
      el('span', { class: 'sync-history-label' }, el('strong', { text: `#${record.revision}` }), ` ${label}`),
      action);
  }));
}

// ── 설정의 '기기 연동' 칸 ────────────────────────────
const STATUS_TEXT = {
  syncing: ['badge-info', '맞추는 중…'],
  synced: ['badge-ok', '연동됨'],
  locked: ['badge-warn', '비밀번호 필요'],
  conflict: ['badge-warn', '다른 기기에서 더 최근에 고침'],
  error: ['badge-danger', '연동 오류'],
};

export function syncSection({ getState, subscribe, sync, downloadBackup }) {
  const body = el('div', { class: 'sync-body' });
  const result = messageLine();
  const report = (tone, text) => (tone ? result.show(tone, text) : result.hide());

  const draw = () => {
    const { status, config } = sync;
    const url = getState().settings.sheetUrl;
    if (!config) {
      const button = el('button', { type: 'button', class: 'btn btn-primary', text: '연동 켜기', disabled: !url });
      button.addEventListener('click', () => startSync({ sync, getState, url, report }));
      body.replaceChildren(
        el('p', { text: '노트북·회사 PC처럼 여러 기기에서 같은 데이터를 고치고 볼 수 있어요. 데이터는 연동 비밀번호로 잠가서, 시세에 쓰는 내 구글 시트에 저장해요.' }),
        url ? null : el('p', { class: 'banner banner-info', text: '먼저 위 "시세 연결"에 내 구글 시트 웹 앱 주소를 넣어 주세요. 연동도 같은 주소를 써요.' }),
        el('div', { class: 'toolbar' }, button),
        result.node,
        el('p', { class: 'muted small', text: `시트 코드(Code.gs)를 새 버전으로 바꾸고 다시 배포해야 쓸 수 있어요 (연결 가이드 참고). ${FORGET_WARNING}` }));
      return;
    }
    const [badge, label] = STATUS_TEXT[status.state] ?? STATUS_TEXT.error;
    let detail = status.message ?? '';
    if (status.state === 'synced' && status.savedAt) detail = `마지막 저장 ${formatSavedAt(status.savedAt)} · ${status.device || '기기'} (#${status.revision})`;
    if (status.state === 'conflict') detail = `${status.remote?.device || '다른 기기'}에서 ${formatSavedAt(status.remote?.savedAt)}에 저장했어요.`;
    const actions = [];
    if (status.state === 'locked') actions.push(el('button', { type: 'button', class: 'btn btn-primary', text: '비밀번호 입력', onClick: () => openUnlockModal({ sync }) }));
    if (status.state === 'conflict') actions.push(el('button', { type: 'button', class: 'btn btn-primary', text: '확인하기', onClick: () => openConflictModal({ sync, downloadBackup }) }));
    if (status.state !== 'locked') {
      actions.push(el('button', { type: 'button', class: 'btn', text: '지금 맞추기', disabled: status.state === 'syncing', onClick: () => sync.sync() }));
      actions.push(el('button', { type: 'button', class: 'btn', text: '저장 기록', onClick: () => openHistoryModal({ sync }) }));
    }
    actions.push(el('button', {
      type: 'button',
      class: 'btn btn-danger',
      text: '이 기기 연동 끄기',
      onClick: async () => {
        const confirmed = await confirmDialog({
          title: '이 기기 연동 끄기',
          message: `이 기기(${config.deviceName})의 연동을 끌까요? 이 기기의 데이터는 그대로 남고, 시트와 다른 기기의 데이터도 그대로예요.${config.remember ? '' : ' 비밀번호를 기억하지 않던 기기라 데이터가 이 브라우저에 계속 남게 돼요. 회사·공용 PC라면 대신 "이 기기에서 데이터 삭제"를 쓰세요.'}`,
          confirmText: '연동 끄기',
          danger: true,
        });
        if (!confirmed) return;
        sync.disconnect();
        showToast('이 기기의 연동을 껐어요');
      },
    }));
    body.replaceChildren(
      el('p', { class: 'sync-status' }, el('span', { class: `badge ${badge}`, text: label }), detail ? el('span', { class: 'muted', text: ` ${detail}` }) : null),
      el('p', { class: 'muted small', text: `이 기기: ${config.deviceName} · ${config.remember ? '비밀번호를 기억해요' : '비밀번호를 기억하지 않아요 (브라우저를 닫으면 이 기기의 데이터가 지워져요)'}` }),
      el('div', { class: 'toolbar' }, actions),
      result.node);
  };

  draw();
  const unsubscribeStatus = sync.onStatus(draw);
  // 위 '시세 연결'에 주소를 넣으면 연동 켜기 버튼을 바로 쓸 수 있게
  let sheetUrl = getState().settings.sheetUrl;
  const unsubscribeState = subscribe((state) => {
    if (state.settings.sheetUrl === sheetUrl) return;
    sheetUrl = state.settings.sheetUrl;
    if (!sync.config) draw();
  });
  return {
    element: el('section', { class: 'card settings-section sync-section', 'aria-label': '기기 연동' },
      el('h2', { class: 'section-title', text: '기기 연동' }),
      body),
    cleanup: () => {
      unsubscribeStatus();
      unsubscribeState();
    },
  };
}

// ── 화면 위 안내 ────────────────────────────────────
// 비밀번호가 필요하거나, 다른 기기와 부딪혔거나, 연동에 실패했을 때. 부딪히면 묻는 창을 바로 띄운다.
export function mountSyncBanner(slot, { sync, downloadBackup, onChange }) {
  let lastConflict = null;
  const draw = (status) => {
    let banner = null;
    if (status.state === 'locked') {
      banner = el('div', { class: 'banner banner-warn sync-banner', role: 'status' },
        el('span', { text: '기기 연동: 비밀번호를 입력하면 최신 데이터를 받아와요.' }),
        el('button', { type: 'button', class: 'btn btn-small', text: '비밀번호 입력', onClick: () => openUnlockModal({ sync }) }));
    } else if (status.state === 'conflict') {
      banner = el('div', { class: 'banner banner-warn sync-banner', role: 'status' },
        el('span', { text: '다른 기기에서 더 최근에 고쳤어요. 최신 내용을 받아 와야 저장돼요.' }),
        el('button', { type: 'button', class: 'btn btn-small', text: '확인하기', onClick: () => openConflictModal({ sync, downloadBackup }) }));
      const key = `${status.remote?.revision}`;
      if (key !== lastConflict) {
        lastConflict = key;
        openConflictModal({ sync, downloadBackup });
      }
    } else if (status.state === 'error') {
      banner = el('div', { class: 'banner banner-danger sync-banner', role: 'status' },
        el('span', { text: `연동하지 못했어요. ${status.message ?? ''}` }),
        el('button', { type: 'button', class: 'btn btn-small', text: '다시 시도', onClick: () => sync.sync() }));
    }
    slot.replaceChildren(...(banner ? [banner] : []));
    onChange?.();
  };
  draw(sync.status);
  sync.onStatus(draw);
}
