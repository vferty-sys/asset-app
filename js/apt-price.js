// 아파트 실거래가: 내 구글 시트 코드(Code.gs)에 단지 목록과 최근 실거래가 평균을 물어본다.
// 공공데이터 인증키는 시트 코드의 스크립트 속성에만 있고, 앱은 시·군·구 코드·단지·전용면적만 보낸다.

import { isPlainObject } from './validate.js';

export const APT_TIMEOUT_MS = 40000;
const DISTRICTS_PATH = './data/districts.json';

export class AptError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AptError';
    this.code = code;
  }
}

export const APT_ERROR_MESSAGES = Object.freeze({
  'no-feature': '시트 코드가 예전 버전이에요. 연결 가이드의 "코드 업데이트"대로 최신 코드로 바꿔 주세요.',
  'no-sheet': '구글 시트를 연결해야 실거래가를 받을 수 있어요. 설정 → 시세 연결에서 시트 주소를 넣어 주세요.',
  'no-key': '시트 코드에 실거래가 인증키가 없어요. 연결 가이드의 "아파트 실거래가 인증키 넣기"를 따라 주세요.',
  key: '인증키가 맞지 않거나 아직 승인 처리 중이에요. 승인 뒤 1~2시간 지나 다시 해 보세요.',
  expired: '인증키 활용 기간이 끝났어요. 공공데이터포털 마이페이지에서 연장 신청해 주세요.',
  limit: '오늘 쓸 수 있는 조회 횟수를 다 썼어요. 내일 다시 해 보세요.',
  'bad-request': '지역·단지·전용면적을 다시 골라 주세요.',
  permission: '시트 코드에 "외부 서비스에 연결" 권한이 없어요. PC에서 Apps Script 편집기를 열고 checkRealEstateKey를 실행해 권한을 모두 허용한 뒤, 새 버전으로 다시 배포해 주세요. (연결 가이드의 "아파트 실거래가" 참고)',
  api: '공공데이터에서 실거래가를 받지 못했어요. 잠시 뒤 다시 해 보세요.',
  network: '시트에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.',
  timeout: '실거래가를 받는 데 시간이 너무 오래 걸려요. 잠시 뒤 다시 해 보세요.',
});

// 시트 코드가 알려 준 자세한 이유를 문구 뒤에 붙인다 (원인을 찾기 쉽게). 인증키는 시트 코드가 보내지 않는다.
const NO_DETAIL = ['no-feature', 'no-sheet', 'no-key', 'network', 'timeout', 'permission'];
// 구글이 "UrlFetchApp … script.external_request 권한이 없다"고 하면 권한 안내로 바꿔 보여 준다
const PERMISSION_ERROR = /script\.external_request|UrlFetchApp/i;
const fail = (rawCode, detail = '') => {
  const code = PERMISSION_ERROR.test(String(detail ?? '')) ? 'permission' : rawCode;
  const base = APT_ERROR_MESSAGES[code] ?? APT_ERROR_MESSAGES.api;
  // 구글 오류 문구에 요청 주소(인증키가 들어 있음)가 섞여 올 수 있어서, 주소의 ? 뒤와 serviceKey 값은 지운다
  const reason = String(detail ?? '')
    .replace(/(https?:\/\/[^\s?#]+)[?#]\S*/gi, '$1?…')
    .replace(/(service_?key\s*[=:]\s*)[^\s&,)]+/gi, '$1…')
    .replace(/\s+/g, ' ').trim().slice(0, 160);
  return new AptError(code, reason && !NO_DETAIL.includes(code) ? `${base} (이유: ${reason})` : base);
};

async function askSheet(sheetUrl, params, { fetchImpl = globalThis.fetch, timeoutMs = APT_TIMEOUT_MS } = {}) {
  if (!sheetUrl) throw fail('no-sheet');
  const url = new URL(sheetUrl);
  for (const [key, value] of Object.entries(params)) if (value != null && value !== '') url.searchParams.set(key, String(value));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url.toString(), { method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'follow', signal: controller.signal });
    if (!response.ok) throw fail('api', `HTTP ${response.status}`);
    let json;
    try {
      json = JSON.parse(await response.text());
    } catch {
      throw fail('api');
    }
    if (!isPlainObject(json)) throw fail('api');
    if (typeof json.aptError === 'string') throw fail(json.aptError, json.message);
    // 예전 시트 코드는 action을 몰라서 그냥 시세를 돌려준다
    if (Object.hasOwn(json, 'prices') && !Object.hasOwn(json, 'complexes') && !Object.hasOwn(json, 'windows')) throw fail('no-feature');
    if (typeof json.error === 'string') throw fail('api', json.error);
    return json;
  } catch (error) {
    if (error instanceof AptError) throw error;
    if (controller.signal.aborted) throw fail('timeout');
    throw fail('network');
  } finally {
    clearTimeout(timer);
  }
}

// 시·군·구에서 최근 12개월 동안 거래된 단지: [{ apt, name, dong, jibun, count, areas: [{ area, count }] }]
export async function fetchAptComplexes(sheetUrl, lawd, options) {
  const json = await askSheet(sheetUrl, { action: 'apt-complexes', lawd }, options);
  return Array.isArray(json.complexes) ? json.complexes.filter((complex) => isPlainObject(complex) && complex.name) : [];
}

// 단지·전용면적의 최근 실거래가 평균 → 부동산 항목에 저장하는 market
//  { average, months, count, min, max, from, to, trades, fetchedAt } (1년 동안 거래가 없으면 average: null, count: 0)
export async function fetchAptPrice(sheetUrl, auto, { now = new Date(), ...options } = {}) {
  const json = await askSheet(sheetUrl, { action: 'apt-price', lawd: auto.lawd, apt: auto.apt, name: auto.name, dong: auto.dong, area: auto.area }, options);
  return marketFromResponse(json, now);
}

export function marketFromResponse(json, now = new Date()) {
  const used = isPlainObject(json.used) ? json.used : null;
  const trades = Array.isArray(json.trades) ? json.trades.filter(isPlainObject).slice(0, 10).map((trade) => ({
    date: String(trade.date ?? ''), amount: Number(trade.amount) || 0, floor: Number(trade.floor) || 0, area: Number(trade.area) || 0,
  })) : [];
  return {
    average: used?.average > 0 ? Math.round(used.average) : null,
    months: used ? Number(used.months) || null : null,
    count: used ? Number(used.count) || 0 : 0,
    min: used?.min > 0 ? used.min : null,
    max: used?.max > 0 ? used.max : null,
    from: used ? String(used.from ?? '') : '',
    to: used ? String(used.to ?? '') : '',
    trades,
    fetchedAt: now.toISOString(),
  };
}

// '202609' → '2026년 9월'
const ymText = (ym) => (/^\d{6}$/.test(ym) ? `${ym.slice(0, 4)}년 ${Number(ym.slice(4))}월` : '');

// '최근 3개월 거래 4건 평균 (2026년 9월~11월)'
export function aptLabel(market) {
  if (!market?.average) return '';
  const range = market.from && market.to
    ? (market.from.slice(0, 4) === market.to.slice(0, 4)
      ? `${ymText(market.from)}~${Number(market.to.slice(4))}월`
      : `${ymText(market.from)}~${ymText(market.to)}`)
    : '';
  return `최근 ${market.months}개월 거래 ${market.count}건 평균${range ? ` (${range})` : ''}`;
}

// 1평 = 3.3058㎡. 흔히 부르는 '34평형'은 공급면적(전용 + 계단·복도 같은 공용 부분) 기준이라,
// 실거래가 자료의 전용면적에 보통 아파트의 공급/전용 비율(약 1.32)을 곱해 어림한다. (전용 84㎡ ≈ 34평형, 59㎡ ≈ 24평형)
const PYEONG_M2 = 3.3058;
const SUPPLY_PER_EXCLUSIVE = 1.32;
export function pyeongType(area) {
  const value = Number(area);
  return value > 0 ? Math.round((value * SUPPLY_PER_EXCLUSIVE) / PYEONG_M2) : null;
}

// 전용면적 '84.97㎡ (약 34평형)'
export function areaText(area) {
  const value = Number(area);
  if (!(value > 0)) return '';
  return `${value.toFixed(2)}㎡ (약 ${pyeongType(value)}평형)`;
}

// 시·군·구 목록: [{ code, sido, name }]
let districtsLoading = null;
export function loadDistricts({ fetchImpl = globalThis.fetch } = {}) {
  if (!districtsLoading) {
    districtsLoading = fetchImpl(DISTRICTS_PATH, { cache: 'no-cache' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => (Array.isArray(data.items) ? data.items.map(([code, sido, name]) => ({ code, sido, name })) : []))
      .catch((error) => {
        districtsLoading = null;
        throw error;
      });
  }
  return districtsLoading;
}
