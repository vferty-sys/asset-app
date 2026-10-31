// 종목 자동 분류: 업종(국내 네이버 금융 업종·미국 GICS)과 ETF 이름·분류로 국가·섹터·자산군·ETF 분산 정도를 짐작한다.
// 종목 목록(data/stocks.json)을 만드는 스크립트와 종목 입력 화면이 함께 쓴다. 짐작이라 사용자가 언제든 바꿀 수 있다.
// 비율(mix)은 { 이름: 퍼센트 } 형태이고, 모르면 null.

import { guessEtfSpread } from './holding.js';

// ── 지수 구성 대략값 (2025년 무렵 기준, 업종·국가 비율 %) ─────────────
// ETF의 실제 비율은 운용사 홈페이지에서 확인해야 해서, 화면에 "대략값"이라고 함께 알린다.
export const APPROX_SECTOR_MIXES = Object.freeze({
  kospi200: { 기술: 45, 금융: 12, 산업재: 13, 소비재: 9, 헬스케어: 7, 소재: 6, 통신: 4, 필수소비재: 2, 에너지: 1, 유틸리티: 1 },
  kosdaq150: { 헬스케어: 32, 기술: 30, 산업재: 16, 소재: 8, 소비재: 6, 통신: 6, 필수소비재: 2 },
  sp500: { 기술: 34, 금융: 13, 헬스케어: 9, 소비재: 10, 통신: 10, 산업재: 8, 필수소비재: 5, 에너지: 3, 유틸리티: 3, 부동산: 2, 소재: 3 },
  nasdaq100: { 기술: 52, 통신: 16, 소비재: 14, 헬스케어: 6, 필수소비재: 5, 산업재: 5, 기타: 2 },
  dow30: { 금융: 26, 기술: 20, 헬스케어: 15, 산업재: 14, 소비재: 14, 필수소비재: 6, 통신: 2, 에너지: 2, 소재: 1 },
  russell2000: { 산업재: 17, 금융: 17, 헬스케어: 16, 기술: 14, 소비재: 10, 에너지: 6, 부동산: 6, 소재: 4, 유틸리티: 3, 필수소비재: 3, 통신: 2, 기타: 2 },
  world: { 기술: 26, 금융: 16, 헬스케어: 10, 산업재: 11, 소비재: 10, 통신: 8, 필수소비재: 6, 에너지: 4, 소재: 4, 유틸리티: 3, 부동산: 2 },
  usDividend: { 에너지: 20, 필수소비재: 19, 헬스케어: 16, 산업재: 12, 금융: 9, 기술: 9, 소비재: 8, 통신: 4, 소재: 3 },
});

export const APPROX_COUNTRY_MIXES = Object.freeze({
  world: { 미국: 72, 유럽: 15, 일본: 5, 기타: 8 },
  allCountry: { 미국: 64, 유럽: 13, 일본: 5, 중국: 3, 신흥국: 7, 기타: 8 },
  developedExUs: { 유럽: 62, 일본: 22, 기타: 16 },
  emerging: { 중국: 27, 신흥국: 73 },
});

// ── 국내 주식: 네이버 금융 업종 → 앱 섹터 ─────────────────────────
// 네이버 금융의 업종 이름(79개, GICS와 비슷한 나눔)을 그대로 대응시킨다.
const KR_INDUSTRY_SECTORS = Object.freeze({
  반도체와반도체장비: '기술', 디스플레이패널: '기술', 디스플레이장비및부품: '기술', 전자장비와기기: '기술', 핸드셋: '기술',
  통신장비: '기술', 컴퓨터와주변기기: '기술', 사무용전자제품: '기술', 소프트웨어: '기술', IT서비스: '기술',
  양방향미디어와서비스: '통신', 게임엔터테인먼트: '통신', 방송과엔터테인먼트: '통신', 광고: '통신', 출판: '통신',
  다각화된통신서비스: '통신', 무선통신서비스: '통신',
  은행: '금융', 증권: '금융', 손해보험: '금융', 생명보험: '금융', 카드: '금융', 기타금융: '금융', 창업투자: '금융',
  제약: '헬스케어', 생물공학: '헬스케어', 생명과학도구및서비스: '헬스케어', 건강관리장비와용품: '헬스케어',
  건강관리업체및서비스: '헬스케어', 건강관리기술: '헬스케어',
  자동차: '소비재', 자동차부품: '소비재', 전자제품: '소비재', 가구: '소비재', 가정용기기와용품: '소비재',
  레저용장비와제품: '소비재', '섬유,의류,신발,호화품': '소비재', '호텔,레스토랑,레저': '소비재', 교육서비스: '소비재',
  다각화된소비자서비스: '소비재', 백화점과일반상점: '소비재', 인터넷과카탈로그소매: '소비재', 전문소매: '소비재', 판매업체: '소비재',
  식품: '필수소비재', 음료: '필수소비재', 담배: '필수소비재', 화장품: '필수소비재', 가정용품: '필수소비재', 식품과기본식료품소매: '필수소비재',
  전기제품: '산업재', 전기장비: '산업재', 기계: '산업재', 조선: '산업재', 우주항공과국방: '산업재', 건설: '산업재', 건축제품: '산업재',
  복합기업: '산업재', 무역회사와판매업체: '산업재', 상업서비스와공급품: '산업재', 문구류: '산업재', 해운사: '산업재', 항공사: '산업재',
  항공화물운송과물류: '산업재', 도로와철도운송: '산업재', 운송인프라: '산업재',
  화학: '소재', 철강: '소재', 비철금속: '소재', 건축자재: '소재', 포장재: '소재', 종이와목재: '소재',
  석유와가스: '에너지', 에너지장비및서비스: '에너지',
  전기유틸리티: '유틸리티', 가스유틸리티: '유틸리티', 복합유틸리티: '유틸리티',
  부동산: '부동산',
});

// 표에 없는 업종 이름(새로 생기거나 바뀐 이름)은 낱말로 짐작한다. 앞에서부터 처음 맞는 규칙을 쓴다.
const KR_INDUSTRY_RULES = [
  [/은행|저축기관|보험|신탁|금융|증권|투자|여신|카드/, '금융'],
  [/부동산/, '부동산'],
  [/전기업|가스 제조 및 배관|배관공급|증기|수도|폐기물/, '유틸리티'],
  [/석유|원유|천연가스|석탄|연료/, '에너지'],
  [/전기 ?통신|방송업|영화|비디오물|오디오물|음반|출판|광고|신문|잡지|포털|인터넷 정보매개|정보 ?서비스/, '통신'],
  [/반도체|전자부품|컴퓨터|소프트웨어|통신 및 방송 장비|영상 및 음향|측정|시험|항해|광학|정보통신|시스템 통합|자료처리|호스팅/, '기술'],
  [/의약|의료|제약|생물학적|바이오|건강|자연과학 및 공학 연구/, '헬스케어'],
  [/축전지|일차전지|전동기|발전기|전기 변환|전기장비|선박|보트|항공기|우주선|철도|기계|건설|토목|건물|엔지니어링|운송|운수|창고|물류|해운|항공 운송|사업 ?지원|인력|경비|시설|무기|총포|구조용 금속|산업용/, '산업재'],
  [/화학|고무|플라스틱|철강|비철|금속|광업|광물|시멘트|유리|요업|종이|펄프|목재|비료|농약|도료|잉크/, '소재'],
  [/식료품|식품|음료|주류|알코올|담배|사료|도축|육류|곡물|과실|채소|낙농|수산|농업|어업|생활용품|세제|화장품/, '필수소비재'],
  [/자동차|트레일러|의복|섬유|가죽|신발|가구|가정용|소매|도매|상품 중개|숙박|음식점|여행|오락|스포츠|교육|게임|완구|악기|귀금속|판매업|렌탈|임대업/, '소비재'],
];

export function sectorFromKrIndustry(industry) {
  const text = String(industry ?? '').trim();
  if (Object.hasOwn(KR_INDUSTRY_SECTORS, text)) return KR_INDUSTRY_SECTORS[text];
  for (const [pattern, sector] of KR_INDUSTRY_RULES) {
    if (pattern.test(text)) return sector;
  }
  return '기타';
}

// ── 미국 주식: GICS 섹터 → 앱 섹터 ─────────────────────────────
const GICS_SECTORS = {
  'Information Technology': '기술',
  'Communication Services': '통신',
  'Consumer Discretionary': '소비재',
  'Consumer Staples': '필수소비재',
  'Health Care': '헬스케어',
  Financials: '금융',
  Industrials: '산업재',
  Energy: '에너지',
  Materials: '소재',
  Utilities: '유틸리티',
  'Real Estate': '부동산',
};

export function sectorFromGics(sector) {
  return GICS_SECTORS[String(sector ?? '').trim()] ?? '기타';
}

// 개별 주식의 자산군: 은행·보험은 배당주, 리츠(부동산 투자회사)는 기타, 그 밖은 성장주
// detail: 국내는 거래소 업종, 미국은 GICS 세부 업종 이름
export function stockAssetClass({ name = '', sector = '', detail = '' } = {}) {
  if (/리츠|REIT/i.test(name) || /REIT/i.test(detail) || (sector === '부동산' && /리츠|투자회사/.test(detail))) return '기타';
  if (/은행|저축기관|보험|Banks?\b|Insurance/i.test(detail)) return '배당주';
  return '성장주';
}

// ── ETF: 이름(과 거래소가 준 분류)으로 짐작 ─────────────────────────
const CASH = /단기채|단기통안|통안채|단기자금|CD금리|KOFR|SOFR|머니마켓|MMF|초단기|MONEY ?MARKET|T-?BILL|0-3 ?MONTH|1-3 ?MONTH|TREASURY BILL/i;
const BOND = /채권|국고채|국채|국공채|회사채|크레딧|금융채|미국채|물가채|TIPS|TREASURY|BOND|AGGREGATE|CORPORATE/i;
const OTHER = /금현물|골드|GOLD|은선물|SILVER|원유|WTI|원자재|구리|농산물|COMMODIT|리츠|REIT|부동산|인프라|TDF|TRF|혼합|달러선물|엔선물|통화/i;
// 배당 ETF와, 개별 주식처럼 배당주로 보는 은행·보험 ETF
const DIVIDEND = /배당|DIVIDEND|커버드콜|COVERED ?CALL|인컴|INCOME|프리미엄|은행|BANK|보험|INSURANCE/i;
const INVERSE = /인버스|곱버스|INVERSE|SHORT|BEAR/i;

const COUNTRY_RULES = [
  [/MSCI ?(WORLD|월드)|선진국|DEVELOPED|월드/i, null, 'world'],
  [/ACWI|전세계|ALL ?COUNTRY|올월드|올 월드|ALL-?WORLD|글로벌|GLOBAL|TDF/i, null, 'allCountry'],
  [/EAFE|미국 ?제외|EX-?US/i, null, 'developedExUs'],
  [/신흥국|이머징|EMERGING/i, null, 'emerging'],
  [/미국|S&P|나스닥|NASDAQ|다우|DOW|필라델피아|러셀|RUSSELL|\bUS\b|U\.S\./i, { 미국: 100 }],
  [/중국|차이나|CHINA|항셍|HANG ?SENG|CSI|홍콩|HONG ?KONG/i, { 중국: 100 }],
  [/일본|JAPAN|니케이|NIKKEI|TOPIX|토픽스/i, { 일본: 100 }],
  [/유럽|EURO|유로|독일|GERMANY|DAX|STOXX|영국|프랑스/i, { 유럽: 100 }],
  [/인도|INDIA|니프티|NIFTY|베트남|VIETNAM|인도네시아|INDONESIA|브라질|BRAZIL|라틴|멕시코|대만|TAIWAN/i, { 신흥국: 100 }],
  // 다른 나라 단서가 없을 때: 국내에만 있는 금리·채권 이름이나 '코리아·한국'이면 한국
  [/CD\s?(1년)?금리|KOFR|통안|머니마켓|국고채|국공채|전단채|코리아|한국/i, { 한국: 100 }],
];

const INDEX_SECTORS = [
  [/코스닥 ?150|KOSDAQ ?150/i, 'kosdaq150'],
  [/코스피|KOSPI|\b200(?!\d)/i, 'kospi200'],
  [/나스닥 ?100|NASDAQ[\s-]*100/i, 'nasdaq100'],
  [/S&P ?500|\bSP ?500/i, 'sp500'],
  [/다우존스 ?(30|산업)|DOW ?JONES ?INDUSTRIAL|\bDOW ?30\b|^DIA$/i, 'dow30'],
  [/러셀 ?2000|RUSSELL ?2000/i, 'russell2000'],
  [/MSCI ?(WORLD|월드)|ACWI|전세계|ALL ?COUNTRY|올월드|선진국|DEVELOPED/i, 'world'],
];

const THEME_SECTORS = [
  [/리츠|REIT|부동산|REAL ESTATE/i, '부동산'],
  [/금현물|골드|GOLD|은선물|SILVER|원자재|COMMODIT|농산물|구리/i, '기타'],
  [/엔터|미디어|커뮤니케이션|COMMUNICATION|통신|TELECOM/i, '통신'],
  [/반도체|SEMICONDUCTOR|\bSOX|\bIT\b|테크|TECH|소프트웨어|SOFTWARE|\bAI\b|인공지능|클라우드|CLOUD|빅테크|메타버스|사이버|양자|플랫폼|인터넷/i, '기술'],
  [/2차전지|이차전지|배터리|BATTERY|리튬|LITHIUM|전기차|\bEV\b|조선|중공업|방산|DEFENSE|기계|건설|인프라|산업재|INDUSTRIAL|운송|해운|항공|우주|원자력|원전|전력기기|전력설비|로봇|ROBOT/i, '산업재'],
  [/바이오|BIO|헬스케어|HEALTH|제약|PHARMA|의료|MEDICAL/i, '헬스케어'],
  [/은행|BANK|금융|FINANCIAL|증권|보험|INSURANCE/i, '금융'],
  [/필수소비|생활소비|음식료|STAPLES|식품/i, '필수소비재'],
  [/자동차|AUTO|경기소비|소비재|CONSUMER|여행|레저|화장품|게임|럭셔리|명품|리테일|RETAIL/i, '소비재'],
  [/에너지|ENERGY|원유|정유|석유|\bOIL\b|천연가스/i, '에너지'],
  [/철강|STEEL|화학|CHEMICAL|소재|MATERIAL|금속|비철/i, '소재'],
  [/유틸리티|UTILIT/i, '유틸리티'],
];

// meta: 목록이 준 분류 (있으면 더 정확)
//   market: '국내' | '해외', assetType: '주식' | '채권' | '원자재' | '통화' | '부동산' | '혼합자산' …, index: 기초지수 이름,
//   broadIndex: 기초지수가 시장 전체 지수인지 (네이버 금융 '국내 시장지수' 분류),
//   fallbackCountry: 이름에 나라 단서가 없을 때 쓸 나라 (예: 국내 채권 ETF는 '한국'), ticker: 티커 (분산 정도 짐작에 씀)
// 돌려주는 값: { assetClass, countryMix, sectorMix, spread, approx } — 모르는 항목은 null, approx는 대략값을 썼는지
export function classifyEtf(name, {
  market = null, assetType = null, index = '', broadIndex = false, fallbackCountry = null, ticker = '',
} = {}) {
  const text = `${name ?? ''} ${index ?? ''}`.trim();
  let approx = false;

  let assetClass = '성장주';
  if (CASH.test(text)) assetClass = '현금성';
  else if (assetType === '채권' || BOND.test(text)) assetClass = '채권';
  else if (['원자재', '통화', '부동산', '혼합자산'].includes(assetType) || OTHER.test(text)) assetClass = '기타';
  else if (INVERSE.test(text)) assetClass = '기타';
  else if (DIVIDEND.test(text)) assetClass = '배당주';

  let countryMix = null;
  if (assetType === '원자재' || /금현물|골드|GOLD|은선물|SILVER|원유|WTI|원자재|구리|농산물|COMMODIT/i.test(text)) countryMix = { 기타: 100 };
  else if (market === '국내') countryMix = { 한국: 100 };
  else {
    for (const [pattern, mix, approxKey] of COUNTRY_RULES) {
      if (!pattern.test(text)) continue;
      if (approxKey) {
        countryMix = { ...APPROX_COUNTRY_MIXES[approxKey] };
        approx = true;
      } else {
        countryMix = { ...mix };
      }
      break;
    }
    if (!countryMix && market === '해외') countryMix = { 기타: 100 };
    if (!countryMix && fallbackCountry) countryMix = { [fallbackCountry]: 100 };
  }

  let sectorMix = null;
  if (assetClass === '현금성') sectorMix = { 현금성: 100 };
  else if (assetClass === '채권') sectorMix = { 채권: 100 };
  else if (INVERSE.test(text)) sectorMix = { 기타: 100 }; // 떨어질 때 버는 상품이라 업종 비중으로 보기 어렵다
  else if (assetType === '원자재') sectorMix = { 기타: 100 }; // 금·은·원유는 기업이 아니라 업종이 없다
  else {
    const theme = THEME_SECTORS.find(([pattern]) => pattern.test(text));
    const indexKey = INDEX_SECTORS.find(([pattern]) => pattern.test(text))?.[1];
    if (theme) sectorMix = { [theme[1]]: 100 };
    else if (assetClass === '배당주' && countryMix?.미국 === 100) {
      sectorMix = { ...APPROX_SECTOR_MIXES.usDividend };
      approx = true;
    } else if (indexKey) {
      sectorMix = { ...APPROX_SECTOR_MIXES[indexKey] };
      approx = true;
    } else if (broadIndex && market === '국내') {
      // 'MSCI Korea', 'KRX300'처럼 이름에 코스피가 없는 국내 시장 지수
      sectorMix = { ...APPROX_SECTOR_MIXES.kospi200 };
      approx = true;
    }
  }

  // 이름으로 업종·테마형이라 짐작했어도 기초지수가 시장 지수면 시장 전체형
  const byName = guessEtfSpread({ name, ticker });
  const marketIndex = broadIndex || (index && guessEtfSpread({ name: index }) === 'market');
  const spread = byName === 'theme' && marketIndex ? 'market' : byName;
  return { assetClass, countryMix, sectorMix, spread, approx };
}
