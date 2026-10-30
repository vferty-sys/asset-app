// 시트 연결 가이드: docs/SHEET_SETUP.md를 읽어 앱 안에서 보여준다.
// 문서 속 <!-- app:code --> 자리에는 Code.gs 코드와 복사 버튼을 넣는다.

import { parseMarkdown, safeUrl } from '../markdown.js';
import { el, clear, showToast } from '../dom.js';

const GUIDE_PATH = './docs/SHEET_SETUP.md';
const CODE_PATH = './apps-script/Code.gs';

async function fetchText(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.text();
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 아래의 예전 방식으로 다시 시도한다.
    }
  }
  const area = el('textarea', { class: 'visually-hidden', readonly: true });
  area.value = text;
  document.body.append(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

function renderInline(nodes, base) {
  return nodes.map((node) => {
    switch (node.type) {
      case 'code':
        return el('code', { text: node.text });
      case 'strong':
        return el('strong', { text: node.text });
      case 'link': {
        const href = safeUrl(node.href, base);
        if (!href) return node.text;
        const external = new URL(href).origin !== window.location.origin;
        return el('a', { href, text: node.text, target: external ? '_blank' : null, rel: external ? 'noopener noreferrer' : null });
      }
      case 'image': {
        const src = safeUrl(node.src, base);
        return src ? el('img', { src, alt: node.alt, loading: 'lazy' }) : null;
      }
      default:
        return node.text;
    }
  });
}

function codeCard(code) {
  if (code == null) {
    return el('p', { class: 'banner banner-warn', text: '코드를 불러오지 못했어요. 저장소의 apps-script/Code.gs 파일을 열어 복사해 주세요.' });
  }
  const button = el('button', { type: 'button', class: 'btn btn-primary btn-small', text: '코드 복사' });
  button.addEventListener('click', async () => {
    const copied = await copyText(code);
    showToast(copied ? '코드를 복사했어요. Apps Script 편집기에 붙여넣으세요.' : '복사하지 못했어요. 아래 코드를 직접 선택해 복사해 주세요.', copied ? 'info' : 'danger', 3500);
  });
  return el('div', { class: 'code-card' },
    el('div', { class: 'code-card-head' }, el('strong', { text: 'Code.gs' }), button),
    el('details', {},
      el('summary', { text: '코드 내용 보기' }),
      el('pre', {}, el('code', { text: code }))));
}

function renderBlocks(blocks, { base, code }) {
  return blocks.map((block, index) => {
    switch (block.type) {
      case 'heading':
        // 문서 맨 위 제목은 화면 제목(h1)과 겹치므로 그리지 않는다.
        if (block.level === 1 && index === 0) return null;
        return el(`h${Math.min(Math.max(block.level, 2), 4)}`, {}, renderInline(block.children, base));
      case 'paragraph':
        return el('p', {}, renderInline(block.children, base));
      case 'list':
        return block.ordered
          ? el('ol', { start: block.start }, block.items.map((item) => el('li', {}, renderInline(item, base))))
          : el('ul', {}, block.items.map((item) => el('li', {}, renderInline(item, base))));
      case 'quote':
        return el('div', { class: 'guide-note' }, renderBlocks(block.children, { base, code }));
      case 'code':
        return el('pre', {}, el('code', { text: block.text }));
      case 'hr':
        return el('hr');
      case 'app':
        return block.name === 'code' ? codeCard(code) : null;
      default:
        return null;
    }
  });
}

export function render(root) {
  let active = true;
  const article = el('article', { class: 'card guide', 'aria-busy': 'true' }, el('p', { class: 'muted', text: '가이드를 불러오는 중…' }));
  root.append(el('a', { class: 'back-link', href: '#settings', text: '← 설정으로 돌아가기' }), article);

  const base = new URL(GUIDE_PATH, window.location.href).href;
  Promise.all([fetchText(GUIDE_PATH), fetchText(CODE_PATH).catch(() => null)])
    .then(([markdown, code]) => {
      if (!active) return;
      clear(article);
      article.removeAttribute('aria-busy');
      article.append(...renderBlocks(parseMarkdown(markdown), { base, code }).filter(Boolean));
    })
    .catch(() => {
      if (!active) return;
      clear(article);
      article.removeAttribute('aria-busy');
      article.append(el('p', { class: 'banner banner-danger', text: '가이드를 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.' }));
    });

  return () => { active = false; };
}
