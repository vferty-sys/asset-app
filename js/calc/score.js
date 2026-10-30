// 포트폴리오 건강도 점수 (요청서 6-3, 100점 만점, 주식 포트폴리오 기준).
// 배점·기준값은 constants.js의 SCORE_RULES / SCORE_GRADES에 있다.

import { NON_COUNTRY_NAMES, NON_SECTOR_NAMES, SCORE_GRADES, SCORE_RULES } from '../constants.js';
import { formatNumber, formatPercentShort, josa } from '../format.js';
import { analyzeDiversification, holdingWeights, largestOf } from './diversification.js';

// fullAt에서 1, zeroAt에서 0, 그 사이는 선형 (높을수록 좋은 값·낮을수록 좋은 값 모두)
export function linearFraction(value, fullAt, zeroAt) {
  if (fullAt === zeroAt) return 1;
  return Math.min(1, Math.max(0, (value - zeroAt) / (fullAt - zeroAt)));
}

export function gradeFor(total) {
  const rounded = Math.round(total);
  return SCORE_GRADES.find((grade) => rounded >= grade.min) ?? SCORE_GRADES[SCORE_GRADES.length - 1];
}

const pct = formatPercentShort;

// 실효 종목 수 = 1 / Σ(비중²): 돈이 고르게 나뉘었다면 몇 종목을 가진 것과 같은지.
// 10종목에 10%씩이면 10, 한 종목 91% + 9종목 1%씩이면 약 1.2.
// ETF는 비중을 etfCountsAs개로 똑같이 나눈 종목들로 본다 (요청서: ETF는 3종목으로 간주).
export function effectiveHoldings(holdings, etfCountsAs = SCORE_RULES.count.etfCountsAs) {
  const hhi = holdings.reduce((sum, item) => {
    const parts = item.type === 'etf' ? etfCountsAs : 1;
    return sum + parts * (item.weight / parts) ** 2;
  }, 0);
  return hhi > 0 ? 1 / hhi : 0;
}

function countItem(holdings) {
  const rule = SCORE_RULES.count;
  const effective = effectiveHoldings(holdings, rule.etfCountsAs);
  const nominal = holdings.reduce((n, item) => n + (item.type === 'etf' ? rule.etfCountsAs : 1), 0);
  const hasEtf = holdings.some((item) => item.type === 'etf');
  let reason;
  if (holdings.length === 1 && !hasEtf) {
    reason = '종목이 1개뿐이에요. 그 종목이 떨어지면 자산 전체가 흔들려요.';
  } else {
    const basis = hasEtf ? `금액 기준, ETF는 ${rule.etfCountsAs}개로 나눠 셈` : '금액 기준';
    reason = `실효 종목 수는 ${formatNumber(effective, { maximumFractionDigits: 1 })}개예요(${basis}).`;
    if (effective < nominal * 0.7) {
      reason += ` 보유 종목은 ${holdings.length}개지만 금액이 일부 종목에 몰려 있어서 더 적게 셌어요.`;
    }
    reason += effective >= rule.fullAt
      ? ` ${rule.fullAt}개 이상이라 만점이에요.`
      : ` 금액을 여러 종목에 고르게 나눌수록 ${rule.fullAt}개에 가까워지고 점수가 올라가요.`;
  }
  return {
    key: 'count', label: '실효 종목 수', max: rule.points,
    points: rule.points * linearFraction(effective, rule.fullAt, rule.zeroAt),
    value: effective, reason,
  };
}

function top3Item(holdings) {
  const rule = SCORE_RULES.top3;
  const top = holdings.slice(0, 3);
  const share = top.reduce((sum, item) => sum + item.weight, 0);
  const names = top.map((item) => item.name).join(', ');
  let reason;
  if (holdings.length < 3) reason = `종목이 ${holdings.length}개라 상위 종목(${names})이 전체를 차지해요.`;
  else if (share <= rule.fullAt) reason = `가장 큰 3종목이 전체의 ${pct(share)}예요. ${pct(rule.fullAt)} 이하라 고르게 나뉘어 있어요.`;
  else reason = `가장 큰 3종목(${names})이 전체의 ${pct(share)}예요. ${pct(rule.fullAt)} 이하로 낮추면 만점이에요.`;
  if (share > rule.fullAt && top.some((item) => item.type === 'etf')) {
    reason += ' ETF는 여러 회사를 담고 있어 실제 쏠림은 이보다 작을 수 있어요.';
  }
  return {
    key: 'top3', label: '상위 3종목 집중도', max: rule.points,
    points: rule.points * linearFraction(share, rule.fullAt, rule.zeroAt),
    value: share, top, reason,
  };
}

function assetClassItem(assetClass) {
  const rule = SCORE_RULES.assetClass;
  const hhi = assetClass.reduce((sum, item) => sum + item.weight ** 2, 0);
  const biggest = assetClass[0];
  let reason = `가장 큰 자산군은 ${biggest.name}${josa(biggest.name, '으로', '로')} ${pct(biggest.weight)}를 차지해요. `;
  if (assetClass.length === 1) reason += '한 자산군에만 모여 있어요. 채권·현금성처럼 다르게 움직이는 자산을 섞으면 점수가 올라가요.';
  else if (hhi <= rule.fullAt) reason += '여러 자산군에 고르게 나뉘어 있어요.';
  else reason += '한쪽으로 몰려 있어요. 다른 자산군의 비중을 늘리면 점수가 올라가요.';
  return {
    key: 'assetClass', label: '자산군 분산', max: rule.points,
    points: rule.points * linearFraction(hhi, rule.fullAt, rule.zeroAt),
    value: hhi, reason: `${reason} (HHI ${formatNumber(hhi, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`,
  };
}

// 가장 큰 섹터(또는 국가)가 기준 이하면 만점, 넘으면 넘은 만큼 줄어 100%에서 0점
function concentrationPart(kind, largest, limitPercent) {
  const each = SCORE_RULES.countrySector.pointsEach;
  const limit = limitPercent / 100;
  if (!largest) return { points: each, sentence: `${kind} 정보가 없어요(기타·미분류만 있음).` };
  const name = `${largest.name}${josa(largest.name, '이', '가')}`;
  if (largest.weight <= limit) {
    return { points: each, sentence: `${kind}는 가장 큰 ${largest.name}도 ${pct(largest.weight)}로 기준 ${limitPercent}% 이하예요.` };
  }
  return {
    points: each * linearFraction(largest.weight, limit, 1),
    sentence: `${kind}는 ${name} ${pct(largest.weight)}로 기준 ${limitPercent}%를 넘었어요.`,
  };
}

function countrySectorItem({ sector, country }, settings) {
  const sectorPart = concentrationPart('섹터', largestOf(sector, NON_SECTOR_NAMES), settings.warnSector);
  const countryPart = concentrationPart('국가', largestOf(country, NON_COUNTRY_NAMES), settings.warnCountry);
  return {
    key: 'countrySector', label: '국가·섹터 쏠림', max: SCORE_RULES.countrySector.pointsEach * 2,
    points: sectorPart.points + countryPart.points,
    reason: `${sectorPart.sentence} ${countryPart.sentence}`,
  };
}

// rows: valuePortfolio(...).rows, settings: 경고 기준(warnSector, warnCountry)
// 평가금액이 있는 종목이 없으면 null
export function scorePortfolio(rows, settings) {
  const holdings = holdingWeights(rows);
  if (holdings.length === 0) return null;
  const stocks = analyzeDiversification(rows);
  const items = [
    countItem(holdings),
    top3Item(holdings),
    assetClassItem(stocks.assetClass),
    countrySectorItem(stocks, settings),
  ];
  const total = items.reduce((sum, item) => sum + item.points, 0);
  return { total, rounded: Math.round(total), grade: gradeFor(total), items };
}
