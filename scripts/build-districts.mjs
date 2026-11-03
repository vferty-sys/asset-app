// 시·군·구 코드 목록(data/districts.json) 만들기 — 아파트 실거래가 조회에서 지역을 고르는 데 쓴다.
// 국토교통부 실거래가 API는 시·군·구 코드(법정동 코드 앞 5자리)로 조회한다.
// 자료: 행정구역 경계를 분기마다 갱신해 공개하는 저장소 vuski/admdongkor 의 가장 최신 GeoJSON
//       (시·군·구 코드·이름만 뽑는다. 행정동 코드의 앞 5자리는 법정동 코드의 시·군·구 코드와 같다)
// 받지 못하면 지난 목록을 그대로 둔다. 실행: node scripts/build-districts.mjs (프록시 뒤에서는 NODE_USE_ENV_PROXY=1)

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'districts.json');
const BASE = 'https://raw.githubusercontent.com/vuski/admdongkor/master';
const MIN_DISTRICTS = 200;

async function text(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${url} — HTTP ${response.status}`);
  return response.text();
}

// '성남시분당구' → '성남시 분당구' (화면에서 읽기 쉽게)
export function districtLabel(name) {
  return String(name ?? '').replace(/^(.+?[시군])(.+[구])$/, '$1 $2');
}

// GeoJSON 글자에서 시·군·구 코드·시도·이름만 뽑는다 (파일이 커서 통째로 JSON으로 읽지 않는다)
export function districtsFromGeoJson(source) {
  const pattern = /"sgg":\s*"(\d{5})",\s*"sido":\s*"\d{2}",\s*"sidonm":\s*"([^"]+)",\s*"sggnm":\s*"([^"]*)"/g;
  const map = new Map();
  let match;
  while ((match = pattern.exec(source))) {
    const [, code, sido, name] = match;
    map.set(code, { code, sido, name: districtLabel(name || sido) });
  }
  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
}

async function main() {
  const readme = await text(`${BASE}/README.md`);
  const versions = [...new Set(readme.match(/ver20\d{6}/g) ?? [])].sort();
  const latest = versions[versions.length - 1];
  if (!latest) throw new Error('최신 버전 이름을 찾지 못했어요');
  const districts = districtsFromGeoJson(await text(`${BASE}/${latest}/HangJeongDong_${latest}.geojson`));
  if (districts.length < MIN_DISTRICTS) throw new Error(`시·군·구가 ${districts.length}개뿐이에요`);
  const body = `${JSON.stringify({ version: latest, count: districts.length, items: districts.map((d) => [d.code, d.sido, d.name]) })}\n`;
  let previous = '';
  try {
    previous = await readFile(OUT, 'utf8');
  } catch {
    // 처음 만드는 경우
  }
  if (previous === body) {
    console.log(`바뀐 내용이 없어요 (${latest}, ${districts.length}개)`);
    return;
  }
  await writeFile(OUT, body);
  console.log(`저장: data/districts.json (${latest}, ${districts.length}개)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`시·군·구 목록을 만들지 못했어요 (지난 목록을 그대로 써요): ${error.message}`);
    process.exit(0);
  });
}
