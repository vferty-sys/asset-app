// 포트폴리오 건강도 점수: 반원 게이지와 항목별 득점·이유. (대시보드에서도 쓴다)

import { el, svg, helpTip, uid } from '../dom.js';
import { formatNumber } from '../format.js';

const HELP = {
  score: [
    '주식 포트폴리오가 한쪽에 쏠리지 않고 잘 나뉘어 있는지 100점 만점으로 매긴 점수예요.',
    '실효 종목 수(20점), 상위 3종목 집중도(30점), 자산군 분산(30점), 국가·섹터 쏠림(20점)을 더해요.',
    '참고용 점수이고, 투자 권유가 아니에요.',
  ],
};

// 항목 이름 옆 (?) 도움말: [용어, 설명]
const ITEM_HELP = {
  count: ['실효 종목 수', [
    '돈이 실제로 몇 군데에 나뉘어 있는지 나타내는 숫자예요. 종목 개수가 아니라 금액 비중으로 세요.',
    '예: 10종목에 10%씩 → 10개, 한 종목 91% + 나머지 9종목 1%씩 → 약 1.2개',
    'ETF는 여러 회사를 담고 있어서 금액을 3종목으로 나눠 세요. 1개 0점, 10개 이상이면 만점이에요.',
  ]],
  assetClass: ['HHI', [
    'HHI는 얼마나 한쪽에 몰려 있는지 나타내는 숫자예요. 자산군 비중을 제곱해서 모두 더해요.',
    '모두 한 자산군이면 1, 네 자산군에 똑같이 나누면 0.25예요. 작을수록 고르게 나뉜 거예요.',
  ]],
};

function points(value) {
  return formatNumber(value, { maximumFractionDigits: 1 });
}

// 반원 게이지. 색은 점수 구간(튼튼해요·괜찮아요·점검이 필요해요·쏠림이 커요)을 따른다.
export function scoreGauge(score, { size = 'large' } = {}) {
  const radius = 80;
  const length = Math.PI * radius;
  const fraction = Math.min(1, Math.max(0, score.total / 100));
  const arc = 'M20 100 A80 80 0 0 1 180 100';
  return el('div', {
    class: `gauge gauge-${size} tone-${score.grade.tone}`,
    role: 'img',
    'aria-label': `포트폴리오 건강도 ${score.rounded}점 (100점 만점), ${score.grade.label}`,
  },
  svg('svg', { viewBox: '0 0 200 112', 'aria-hidden': 'true' },
    svg('path', { class: 'gauge-track', d: arc }),
    svg('path', { class: 'gauge-fill', d: arc, 'stroke-dasharray': `${length * fraction} ${length}` })),
  el('div', { class: 'gauge-center', 'aria-hidden': 'true' },
    el('span', { class: 'gauge-value' }, String(score.rounded), el('small', { text: '점' })),
    el('span', { class: 'gauge-label', text: score.grade.label })));
}

export function scoreCard(score) {
  const titleId = uid('score-title');
  return el('section', { class: 'card score-card', 'aria-labelledby': titleId },
    el('div', { class: 'score-head' },
      el('h2', { class: 'section-title', id: titleId }, '포트폴리오 건강도'),
      helpTip('포트폴리오 건강도', HELP.score)),
    el('div', { class: 'score-body' },
      scoreGauge(score),
      el('ul', { class: 'score-items' }, score.items.map((item) => el('li', { class: 'score-item' },
        el('div', { class: 'score-item-head' },
          el('span', { class: 'score-item-label' }, item.label, ITEM_HELP[item.key] ? helpTip(...ITEM_HELP[item.key]) : null),
          el('span', { class: 'score-item-points', text: `${points(item.points)} / ${item.max}점` })),
        el('div', {
          class: 'meter',
          role: 'meter',
          'aria-label': `${item.label} ${points(item.points)}점 (${item.max}점 만점)`,
          'aria-valuemin': '0',
          'aria-valuemax': String(item.max),
          'aria-valuenow': points(item.points),
        }, el('span', { class: 'meter-fill', style: `width: ${(item.points / item.max) * 100}%` })),
        el('p', { class: 'score-item-reason', text: item.reason }))))));
}
