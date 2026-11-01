// ETF 국가 비중표: 국가 쏠림을 ETF가 상장된 나라가 아니라 실제로 투자하는 나라 기준으로 계산할 때 쓴다.
//  - single_country: 한 나라 지수 → 그 나라 100% (종목명에 이 이름이 있으면 그 나라로 본다)
//  - etf_country_weights: 여러 나라 지수 → 나라별 비중 (합계 1.0, 상위 나라 밖의 나머지는 '기타')
//  - fallback_category: 비중표에 없는 다국가 ETF를 임시로 넣는 이름 (분석 화면에 '국가별 분해 미반영'으로 표시)
// 갱신: 1년에 한 번 운용사(지수 회사) 자료를 보고 숫자를 고치고 meta.updated_at을 바꾼다.
//       항목을 더하려면 etf_country_weights에 한 줄 추가하면 입력 화면의 '비중표' 목록에 바로 나온다.
// 나라 이름은 constants.js의 COUNTRY_OPTIONS에 있어야 한다 (tests/country-weights.test.js가 검사).

export const COUNTRY_WEIGHTS = Object.freeze({
  meta: {
    updated_at: '2026-11-01',
    note: '운용사 자료 기준, 연 1회 수동 갱신. 아래 숫자는 예시값(대략치)이므로 반드시 운용사 자료로 확인 후 교체할 것.',
  },
  single_country: {
    'S&P500': '미국',
    나스닥100: '미국',
    코스피200: '한국',
    닛케이225: '일본',
  },
  etf_country_weights: {
    'MSCI World': {
      미국: 0.72, 일본: 0.055, 영국: 0.035, 캐나다: 0.03,
      프랑스: 0.028, 독일: 0.024, 스위스: 0.023, 호주: 0.02, 기타: 0.065,
    },
    'MSCI ACWI': {
      미국: 0.64, 일본: 0.05, 영국: 0.03, 중국: 0.03,
      캐나다: 0.027, 프랑스: 0.025, 기타: 0.198,
    },
    'MSCI EM': {
      중국: 0.28, 대만: 0.20, 인도: 0.19, 한국: 0.09,
      브라질: 0.045, 기타: 0.195,
    },
  },
  fallback_category: '글로벌(다국가)',
});

export const COUNTRY_PRESETS = Object.freeze(Object.keys(COUNTRY_WEIGHTS.etf_country_weights));
export const GLOBAL_COUNTRY = COUNTRY_WEIGHTS.fallback_category;

// 비중표 항목 → { 나라: 퍼센트 }. 없는 항목이면 null
export function presetMix(key) {
  const weights = Object.hasOwn(COUNTRY_WEIGHTS.etf_country_weights, key) ? COUNTRY_WEIGHTS.etf_country_weights[key] : null;
  if (!weights) return null;
  return Object.fromEntries(Object.entries(weights).map(([country, weight]) => [country, Math.round(weight * 10000) / 100]));
}

// 합계가 1.0이 아닌 비중표 항목 (분석 화면에 경고로 보여준다)
export function weightTableIssues(table = COUNTRY_WEIGHTS) {
  return Object.entries(table.etf_country_weights)
    .map(([key, weights]) => ({ key, sum: Math.round(Object.values(weights).reduce((total, weight) => total + weight, 0) * 10000) / 10000 }))
    .filter(({ sum }) => Math.abs(sum - 1) > 0.0005);
}

// 종목명에 한 나라 지수 이름(S&P500, 코스피200 …)이 있으면 그 나라. 띄어쓰기·대소문자는 따지지 않는다.
export function singleCountryOf(name) {
  const text = String(name ?? '').toUpperCase().replace(/\s+/g, '');
  for (const [index, country] of Object.entries(COUNTRY_WEIGHTS.single_country)) {
    if (text.includes(index.toUpperCase().replace(/\s+/g, ''))) return country;
  }
  return null;
}

// 한 종목의 국가 비율 (분산 분석에 쓰는 값). 비중표 항목을 골랐으면 지금 비중표 값으로 계산해서
// 비중표를 고치면 바로 반영된다. 비중표에서 빠진 항목이면 '글로벌(다국가)'로 본다.
export function holdingCountryMix(holding) {
  if (holding?.countryPreset) return presetMix(holding.countryPreset) ?? { [GLOBAL_COUNTRY]: 100 };
  return holding?.countryMix ?? {};
}
