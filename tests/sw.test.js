// 서비스 워커가 오프라인용으로 저장하는 파일 목록과 PWA 설정(manifest.json, 아이콘)을 검사한다.
// 파일을 추가·삭제했는데 sw.js의 APP_FILES를 고치지 않으면 여기서 실패한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => readFileSync(join(ROOT, file), 'utf8');

function listFiles(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(ROOT, path)).isDirectory() ? listFiles(path) : [path];
  });
}

function appFilesInServiceWorker() {
  const block = /const APP_FILES = \[([\s\S]*?)\];/.exec(read('sw.js'))[1];
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

// PNG 파일 머리말에서 가로·세로 크기를 읽는다.
function pngSize(file) {
  const bytes = readFileSync(join(ROOT, file));
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test('서비스 워커의 앱 파일 목록 = 실제 앱 파일 (css·js 전부, 가이드 문서와 코드, 아이콘)', () => {
  const actual = [
    'index.html',
    'manifest.json',
    ...listFiles('css'),
    ...listFiles('js'),
    // 종목명 자동완성에 쓰는 종목 목록
    ...listFiles('data'),
    // 시트 연결 가이드 화면이 불러오는 문서와 코드
    /GUIDE_PATH = '\.\/([^']+)'/.exec(read('js/ui/guide.js'))[1],
    /CODE_PATH = '\.\/([^']+)'/.exec(read('js/ui/guide.js'))[1],
    ...listFiles('icons'),
  ].map((file) => `./${file.split(sep).join('/')}`);
  const listed = appFilesInServiceWorker().filter((file) => file !== './');
  assert.deepEqual([...listed].sort(), actual.sort());
  assert.equal(new Set(listed).size, listed.length, '같은 파일이 두 번 들어 있음');
  assert.ok(appFilesInServiceWorker().includes('./'), '앱 첫 화면(./)도 저장해야 함');
});

test('서비스 워커: 캐시 버전이 있고, 구글 시트 등 다른 주소 요청은 건드리지 않는다', () => {
  const source = read('sw.js');
  assert.match(source, /const CACHE_VERSION = 'v\d+';/);
  assert.match(source, /if \(new URL\(request\.url\)\.origin !== self\.location\.origin\) return;/);
  // 차트 도구는 charts.js와 같은 주소(버전 고정)만 저장한다
  const chartUrl = /const CHART_SRC = '([^']+)'/.exec(read('js/charts.js'))[1];
  assert.ok(source.includes(`const CHART_URL = '${chartUrl}';`));
});

test('manifest.json: 이름·시작 주소·홈 화면 모드, 아이콘 파일이 있고 크기가 맞다', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.name && manifest.short_name);
  assert.ok(manifest.start_url.startsWith('./'), 'GitHub Pages 하위 주소에서도 동작하게 상대 경로');
  assert.equal(manifest.scope, './');
  for (const icon of manifest.icons) {
    assert.ok(existsSync(join(ROOT, icon.src)), `${icon.src} 없음`);
    const [width, height] = pngSize(icon.src);
    assert.equal(`${width}x${height}`, icon.sizes);
  }
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
  assert.deepEqual(pngSize('icons/apple-touch-icon.png'), [180, 180]);
});

test('index.html이 manifest와 아이콘을 상대 경로로 연결한다', () => {
  const html = read('index.html');
  for (const href of ['./manifest.json', './icons/apple-touch-icon.png', './icons/icon.svg', './icons/favicon-32.png']) {
    assert.ok(html.includes(`href="${href}"`), `${href} 연결 없음`);
    assert.ok(existsSync(join(ROOT, href)), `${href} 파일 없음`);
  }
  assert.equal(relative(ROOT, join(ROOT, 'sw.js')), 'sw.js');
});
