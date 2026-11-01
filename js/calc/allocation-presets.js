// 이름난 투자자들이 제안한 자산 배분 비율 — 리밸런싱 목표 비중을 고를 때 참고용 (투자 권유가 아님).
// 주식 계좌(보유 종목)에 맞춘다. 비율은 주식·채권·현금성·기타(금·원자재·리츠) 네 가지로 적고,
// 앱의 자산군으로 바꿀 때 주식 몫은 지금 계좌의 성장주:배당주 비율대로 나눈다.

// stocks: 주식, bonds: 채권(국채·물가채 등), cash: 현금성(단기 국채·현금), other: 기타(금·원자재·리츠)
// byAge: 나이로 비율을 정하는 방식 (출생연도가 있어야 쓸 수 있다)
export const ALLOCATION_PRESETS = Object.freeze([
  {
    id: 'bogle',
    name: '나이만큼 채권',
    by: '존 보글 · 뱅가드 창업자, 인덱스 투자의 아버지',
    summary: '채권을 내 나이만큼 두고 나머지는 주식에 둬요. 나이가 들수록 저절로 안전해져요.',
    detail: '예: 47세면 주식 53 · 채권 47',
    byAge: true,
    mix: (age) => ({ stocks: 100 - age, bonds: age }),
  },
  {
    id: 'sixty-forty',
    name: '60/40 균형',
    by: '전통적인 균형형',
    summary: '주식 60, 채권 40. 가장 널리 쓰이는 기준이에요.',
    mix: () => ({ stocks: 60, bonds: 40 }),
  },
  {
    id: 'graham',
    name: '50/50',
    by: '벤저민 그레이엄 · 가치투자의 아버지',
    summary: '주식과 채권 반반이 기본이에요. 시장이 비싸 보이면 주식을 25%까지 줄이고, 싸 보이면 75%까지 늘리라고 했어요.',
    mix: () => ({ stocks: 50, bonds: 50 }),
  },
  {
    id: 'buffett',
    name: '90/10',
    by: '워런 버핏',
    summary: 'S&P500 인덱스 펀드 90, 단기 국채 10. 가족을 위해 남긴 지침으로 밝힌 비율이에요(2013년 주주서한).',
    detail: '오래 버틸 수 있을 때 쓰는 공격형',
    mix: () => ({ stocks: 90, cash: 10 }),
  },
  {
    id: 'all-weather',
    name: '올웨더',
    by: '레이 달리오 · 브리지워터',
    summary: '경기가 좋을 때·나쁠 때·물가가 오를 때·내릴 때 모두 버티도록 나눠요.',
    detail: '주식 30, 장기 국채 40, 중기 국채 15, 금 7.5, 원자재 7.5',
    mix: () => ({ stocks: 30, bonds: 55, other: 15 }),
  },
  {
    id: 'permanent',
    name: '영구 포트폴리오',
    by: '해리 브라운',
    summary: '주식·장기 국채·현금·금을 25%씩. 가장 방어적인 배분이에요.',
    mix: () => ({ stocks: 25, bonds: 25, cash: 25, other: 25 }),
  },
  {
    id: 'yale',
    name: '예일 모델',
    by: '데이비드 스웬슨 · 예일대 기금',
    summary: '대학 기금 운용 방식을 개인용으로 줄인 배분이에요.',
    detail: '국내 주식 30, 선진국 15, 신흥국 5, 리츠 20, 국채 15, 물가연동 국채 15',
    mix: () => ({ stocks: 50, bonds: 30, other: 20 }),
  },
]);

// 나이만큼 채권: 너무 이르거나 늦은 나이도 주식·채권이 0이 되지 않게 10~90%로 둔다
const AGE_RANGE = [10, 90];

export function presetById(id) {
  return ALLOCATION_PRESETS.find((preset) => preset.id === id) ?? null;
}

// 프리셋의 네 가지 비율. 나이로 정하는 방식인데 나이를 모르면 null
export function presetMix(preset, { age = null } = {}) {
  if (!preset.byAge) return preset.mix();
  if (!Number.isFinite(age)) return null;
  return preset.mix(Math.min(AGE_RANGE[1], Math.max(AGE_RANGE[0], Math.round(age))));
}

// 안전자산(채권 + 현금성) 비율 — IRP는 30% 이상이어야 한다
export function safeShare(mix) {
  return (mix?.bonds ?? 0) + (mix?.cash ?? 0);
}

const round1 = (value) => Math.round(value * 10) / 10;

// 네 가지 비율 → 앱 자산군 목표(%). 주식 몫은 growthShare(성장주 ÷ (성장주 + 배당주))로 나눈다.
// 0인 자산군은 빼고, 합계가 정확히 100이 되게 한다.
export function presetTargets(mix, { growthShare = 1 } = {}) {
  if (!mix) return null;
  const share = Number.isFinite(growthShare) ? Math.min(1, Math.max(0, growthShare)) : 1;
  const stocks = mix.stocks ?? 0;
  const growth = round1(stocks * share);
  const targets = {
    성장주: growth,
    배당주: round1(stocks - growth),
    채권: mix.bonds ?? 0,
    현금성: mix.cash ?? 0,
    기타: mix.other ?? 0,
  };
  return Object.fromEntries(Object.entries(targets).filter(([, value]) => value > 0));
}

// 지금 계좌의 성장주 몫 (성장주 ÷ (성장주 + 배당주)). 둘 다 없으면 1 (모두 성장주)
// assetClassWeights: analyzeDiversification(rows).assetClass
export function growthShareOf(assetClassWeights = []) {
  const weightOf = (name) => assetClassWeights.find((item) => item.name === name)?.weight ?? 0;
  const growth = weightOf('성장주');
  const dividend = weightOf('배당주');
  return growth + dividend > 0 ? growth / (growth + dividend) : 1;
}
