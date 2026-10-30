import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseInline, parseMarkdown, safeUrl } from '../js/markdown.js';

const text = (value) => ({ type: 'text', text: value });

test('제목, 문단(줄은 공백으로 이어 붙임), 구분선', () => {
  assert.deepEqual(parseMarkdown('# 제목\n\n첫 줄\n둘째 줄\n\n---\n## 소제목'), [
    { type: 'heading', level: 1, children: [text('제목')] },
    { type: 'paragraph', children: [text('첫 줄 둘째 줄')] },
    { type: 'hr' },
    { type: 'heading', level: 2, children: [text('소제목')] },
  ]);
});

test('번호 목록(시작 번호 유지)과 글머리표 목록, 들여쓴 줄은 앞 항목에 이어 붙인다', () => {
  assert.deepEqual(parseMarkdown('3. 셋\n4. 넷\n   이어짐\n\n- 가\n* 나'), [
    { type: 'list', ordered: true, start: 3, items: [[text('셋')], [text('넷 이어짐')]] },
    { type: 'list', ordered: false, start: 1, items: [[text('가')], [text('나')]] },
  ]);
});

test('코드 블록 안의 내용은 그대로 둔다', () => {
  assert.deepEqual(parseMarkdown('```js\nconst a = `x`;\n\n# 제목 아님\n```'), [
    { type: 'code', lang: 'js', text: 'const a = `x`;\n\n# 제목 아님' },
  ]);
});

test('인용 안에 문단 여러 개', () => {
  assert.deepEqual(parseMarkdown('> 첫 문단\n>\n> 둘째 문단'), [
    { type: 'quote', children: [
      { type: 'paragraph', children: [text('첫 문단')] },
      { type: 'paragraph', children: [text('둘째 문단')] },
    ] },
  ]);
});

test('주석은 건너뛰고, app: 표시만 블록으로 남긴다 (여러 줄 주석 포함)', () => {
  assert.deepEqual(parseMarkdown('앞\n<!-- 스크린샷: 메뉴 -->\n<!--\n  여러 줄\n  주석\n-->\n<!-- app:code -->\n뒤'), [
    { type: 'paragraph', children: [text('앞')] },
    { type: 'app', name: 'code' },
    { type: 'paragraph', children: [text('뒤')] },
  ]);
});

test('줄 안 문법: 코드, 굵게, 링크, 그림', () => {
  assert.deepEqual(parseInline('**설정**에서 `KRX:005930`을 [가이드](./a.md) 보고 ![그림](img.png) 끝'), [
    { type: 'strong', text: '설정' },
    text('에서 '),
    { type: 'code', text: 'KRX:005930' },
    text('을 '),
    { type: 'link', text: '가이드', href: './a.md' },
    text(' 보고 '),
    { type: 'image', alt: '그림', src: 'img.png' },
    text(' 끝'),
  ]);
});

test('safeUrl: http(s)와 상대 주소만 허용', () => {
  const base = 'https://me.github.io/asset-app/docs/SHEET_SETUP.md';
  assert.equal(safeUrl('../apps-script/Code.gs', base), 'https://me.github.io/asset-app/apps-script/Code.gs');
  assert.equal(safeUrl('https://sheets.new', base), 'https://sheets.new/');
  assert.equal(safeUrl('javascript:alert(1)', base), null);
  assert.equal(safeUrl('data:text/html,hi', base), null);
});

test('실제 시트 연결 가이드: 주석이 화면에 새지 않고, 코드 카드 자리가 한 곳 있다', () => {
  const blocks = parseMarkdown(readFileSync(new URL('../docs/SHEET_SETUP.md', import.meta.url), 'utf8'));
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks.filter((block) => block.type === 'app' && block.name === 'code').length, 1);
  assert.ok(!JSON.stringify(blocks).includes('<!--'));
  assert.ok(!JSON.stringify(blocks).includes('스크린샷'));
});
