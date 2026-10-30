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

export function helpTip(term, text) {
  setupTipListeners();
  const pop = el('span', { class: 'help-pop', role: 'tooltip', id: uid('tip'), hidden: true },
    el('strong', { text: term }), el('span', { text }));
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
