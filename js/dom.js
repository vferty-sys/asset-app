// 화면 요소를 만드는 도우미. 사용자 입력은 항상 textContent로 넣고 innerHTML은 쓰지 않는다.

let idCounter = 0;

export function uid(prefix = 'id') {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function appendChildren(node, children) {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) appendChildren(node, child);
    else if (child instanceof Node) node.append(child);
    else node.append(document.createTextNode(String(child)));
  }
}

// el('button', { class: 'btn', onClick: fn, text: '저장' })
// props: class, text, dataset, on<Event>, value/checked(속성으로 설정), 그 외는 HTML 속성
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  let value;
  let checked;
  for (const [key, prop] of Object.entries(props ?? {})) {
    if (prop == null || prop === false) continue;
    if (key === 'class') node.className = prop;
    else if (key === 'text') node.textContent = String(prop);
    else if (key === 'dataset') Object.assign(node.dataset, prop);
    else if (key === 'value') value = prop;
    else if (key === 'checked') checked = prop;
    else if (key.startsWith('on') && typeof prop === 'function') node.addEventListener(key.slice(2).toLowerCase(), prop);
    else node.setAttribute(key, prop === true ? '' : String(prop));
  }
  appendChildren(node, children);
  // select는 option이 들어간 뒤에 value를 정해야 한다.
  if (value !== undefined) node.value = String(value);
  if (checked !== undefined) node.checked = Boolean(checked);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  children.forEach((child) => node.append(child));
  return node;
}

export function clear(node) {
  node.replaceChildren();
}

// ── 토스트 알림 ─────────────────────────────────────────
let toastTimer = null;

export function showToast(message, tone = 'info', duration = 2200) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  clearTimeout(toastTimer);
  const node = el('div', { class: `toast toast-${tone}`, text: message });
  root.replaceChildren(node);
  requestAnimationFrame(() => node.classList.add('is-visible'));
  toastTimer = setTimeout(() => {
    node.classList.remove('is-visible');
    setTimeout(() => node.remove(), 250);
  }, duration);
}

// ── 모달 ───────────────────────────────────────────────
let scrollLocks = 0;

function lockScroll() {
  scrollLocks += 1;
  document.documentElement.classList.add('modal-open');
}

function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.documentElement.classList.remove('modal-open');
}

export function closeIcon() {
  return svg('svg', { class: 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, svg('path', { d: 'M6 6l12 12M18 6L6 18' }));
}

// 화면 위에 뜨는 창. 모바일에서는 아래에서 올라오는 시트 모양이다.
// size: 'md'(입력 양식) | 'sm'(확인 창)
export function openModal({ title, body, footer, size = 'md', onClose }) {
  const titleId = uid('modal-title');
  const heading = el('h2', { id: titleId, class: 'modal-title', tabindex: '-1', text: title });
  const closeButton = el('button', { type: 'button', class: 'icon-btn modal-close', 'aria-label': '닫기' }, closeIcon());
  const dialog = el('dialog', { class: `modal modal-${size}`, 'aria-labelledby': titleId },
    el('div', { class: 'modal-head' }, heading, closeButton),
    el('div', { class: 'modal-body' }, body),
    footer ? el('div', { class: 'modal-foot' }, footer) : null);

  const close = () => {
    if (dialog.open) dialog.close();
  };
  closeButton.addEventListener('click', close);
  dialog.addEventListener('close', () => {
    dialog.remove();
    unlockScroll();
    onClose?.();
  });

  document.body.append(dialog);
  dialog.showModal();
  lockScroll();
  // 입력 칸에 바로 초점을 주면 휴대폰 키보드가 튀어나오므로 제목에 초점을 둔다.
  heading.focus();
  return { dialog, close };
}

export function closeAllModals() {
  document.querySelectorAll('dialog.modal[open]').forEach((dialog) => dialog.close());
}

// 확인 창. 확인을 누르면 true, 그 밖에는 false로 끝나는 Promise.
export function confirmDialog({ title, message, confirmText = '확인', cancelText = '취소', danger = false }) {
  return new Promise((resolve) => {
    let confirmed = false;
    const cancelButton = el('button', { type: 'button', class: 'btn', text: cancelText });
    const confirmButton = el('button', {
      type: 'button', class: `btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`, text: confirmText,
    });
    const { close } = openModal({
      title,
      size: 'sm',
      body: el('p', { class: 'confirm-message', text: message }),
      footer: [cancelButton, confirmButton],
      onClose: () => resolve(confirmed),
    });
    cancelButton.addEventListener('click', close);
    confirmButton.addEventListener('click', () => {
      confirmed = true;
      close();
    });
  });
}

// ── (?) 용어 도움말 ─────────────────────────────────────
let openTip = null;

function closeTip() {
  if (!openTip) return;
  openTip.button.setAttribute('aria-expanded', 'false');
  openTip.pop.hidden = true;
  openTip = null;
}

function placeTip(button, pop) {
  const margin = 8;
  const gap = 6;
  const rect = button.getBoundingClientRect();
  const width = pop.offsetWidth;
  const height = pop.offsetHeight;
  const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, margin), window.innerWidth - width - margin);
  const below = rect.bottom + gap;
  const top = below + height > window.innerHeight - margin ? Math.max(rect.top - gap - height, margin) : below;
  pop.style.left = `${Math.max(left, margin)}px`;
  pop.style.top = `${top}px`;
}

let tipListenersReady = false;

function setupTipListeners() {
  if (tipListenersReady) return;
  tipListenersReady = true;
  document.addEventListener('click', (event) => {
    if (openTip && !openTip.pop.contains(event.target)) closeTip();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && openTip) {
      const { button } = openTip;
      closeTip();
      button.focus();
    }
  });
  window.addEventListener('resize', closeTip);
  window.addEventListener('scroll', closeTip, { passive: true, capture: true });
  window.addEventListener('hashchange', closeTip);
}

// text가 배열이면 한 줄씩 나눠 보여준다.
export function helpTip(term, text) {
  setupTipListeners();
  const lines = Array.isArray(text) ? text : [text];
  const pop = el('span', { class: 'help-pop', role: 'tooltip', id: uid('tip'), hidden: true },
    el('strong', { text: term }), lines.map((line) => el('span', { text: line })));
  const button = el('button', {
    type: 'button',
    class: 'help',
    'aria-label': `${term} 설명 보기`,
    'aria-expanded': 'false',
    'aria-controls': pop.id,
    text: '?',
  });
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const wasOpen = openTip?.button === button;
    closeTip();
    if (wasOpen) return;
    pop.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    placeTip(button, pop);
    openTip = { button, pop };
  });
  return el('span', { class: 'help-wrap' }, button, pop);
}
