// 가이드 문서(docs/*.md)를 앱 안에서 보여주기 위한 작은 Markdown 파서.
// 우리 문서에 쓰는 문법만 지원한다:
//   블록: 제목(#~####), 문단, 목록(-, 1.), 인용(>), 코드 블록(```), 구분선(---), 주석(<!-- -->)
//   줄 안: `코드`, **굵게**, [링크](주소), ![그림](주소)
// HTML 문자열이 아니라 단순한 객체 트리를 돌려주고, 화면은 textContent로만 그린다.
// <!-- app:이름 --> 주석은 앱 화면에서 특별한 블록(예: 코드 복사 카드)을 넣을 자리로 쓴다.

const INLINE_PATTERN = /(!?)\[([^\]]*)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*/g;
const ORDERED_ITEM = /^(\d+)\.\s+(.*)$/;
const BULLET_ITEM = /^[-*]\s+(.*)$/;

export function parseInline(text) {
  const nodes = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    if (match.index > last) nodes.push({ type: 'text', text: text.slice(last, match.index) });
    if (match[3] !== undefined) {
      nodes.push(match[1] ? { type: 'image', alt: match[2], src: match[3] } : { type: 'link', text: match[2], href: match[3] });
    } else if (match[4] !== undefined) {
      nodes.push({ type: 'code', text: match[4] });
    } else {
      nodes.push({ type: 'strong', text: match[5] });
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push({ type: 'text', text: text.slice(last) });
  return nodes;
}

export function parseMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (trimmed.startsWith('```')) {
      flushParagraph();
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: 'code', lang: trimmed.slice(3).trim(), text: code.join('\n') });
      i += 1;
      continue;
    }

    if (trimmed.startsWith('<!--')) {
      flushParagraph();
      const comment = [trimmed];
      while (!comment[comment.length - 1].includes('-->') && i + 1 < lines.length) {
        i += 1;
        comment.push(lines[i].trim());
      }
      const body = comment.join('\n').replace(/^<!--/, '').replace(/-->$/, '').trim();
      const marker = /^app:([\w-]+)$/.exec(body);
      if (marker) blocks.push({ type: 'app', name: marker[1] });
      i += 1;
      continue;
    }

    if (trimmed === '') {
      flushParagraph();
      i += 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      blocks.push({ type: 'heading', level: heading[1].length, children: parseInline(heading[2]) });
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushParagraph();
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    if (trimmed.startsWith('>')) {
      flushParagraph();
      const quote = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quote.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', children: parseMarkdown(quote.join('\n')) });
      continue;
    }

    const ordered = ORDERED_ITEM.exec(trimmed);
    if (ordered || BULLET_ITEM.test(trimmed)) {
      flushParagraph();
      const pattern = ordered ? ORDERED_ITEM : BULLET_ITEM;
      const items = [];
      while (i < lines.length) {
        const line = lines[i];
        const match = pattern.exec(line.trim());
        if (match) {
          items.push(ordered ? match[2] : match[1]);
        } else if (items.length > 0 && line.trim() !== '' && /^\s{2,}/.test(line)) {
          // 들여쓴 줄은 앞 항목에 이어 붙인다.
          items[items.length - 1] += ` ${line.trim()}`;
        } else {
          break;
        }
        i += 1;
      }
      blocks.push({
        type: 'list',
        ordered: Boolean(ordered),
        start: ordered ? Number(ordered[1]) : 1,
        items: items.map(parseInline),
      });
      continue;
    }

    paragraph.push(trimmed);
    i += 1;
  }
  flushParagraph();
  return blocks;
}

// 링크·그림 주소는 http(s)와 상대 주소만 허용한다. 안전하지 않으면 null.
export function safeUrl(href, base) {
  try {
    const url = new URL(href, base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}
