// 대시보드: 총자산(투자자산 + 기타 금융자산), 평가손익·수익률, 예상 월 연금액, 예상 연 배당금,
// 건강도 점수와 쏠림 경고 요약, 확인할 것(1년 넘게 고치지 않은 항목·시세 문제), 월별 기록과 총자산 추이

import { STALE_AFTER_DAYS } from '../constants.js';
import { dividendBasis } from '../dividends.js';
import { valuePortfolio } from '../calc/valuation.js';
import { analyzeDiversification, concentrationAlerts, holdingWeights } from '../calc/diversification.js';
import { scorePortfolio } from '../calc/score.js';
import { assetSummary, netWorth, valueByAccount } from '../calc/totals.js';
import { loansSummary } from '../calc/loan.js';
import { realEstateTotal } from '../real-estate.js';
import { cashInKRW } from '../cash.js';
import { pensionSummary, planPensions } from '../calc/projection.js';
import { loadChartLibrary, renderTrendChart } from '../charts.js';
import { ageAt, currentMonthIndex, durationText, formatMonthIndex, isOlderThan, parseMonth, toYearMonth } from '../dates.js';
import { getMarket, getPriceStatus, subscribeMarket } from '../market.js';
import { createSnapshot, latestChange, shouldSuggestSnapshot, upsertSnapshot } from '../snapshot.js';
import { el, clear, confirmDialog, helpTip, showToast, svg, uid } from '../dom.js';
import {
  EMPTY, formatDate, formatMoney, formatPercent, formatPercentShort, formatYearMonth, josa, pnlClass,
} from '../format.js';
import { scoreGauge } from './score-view.js';
import { segmented } from './form.js';

const HELP = {
  total: [
    '투자자산(보유 종목 평가금액 + 예수금)과 기타 금융자산(공제회·예적금, 계좌에 연결하지 않은 연금 적립금)을 더한 금액이에요.',
    '"부동산 포함"을 고르면 집값(부동산)도 더해요. 월별 기록(총자산 추이)은 어느 쪽이든 금융자산만 기록해요.',
    '계좌에 연결한 연금은 보유 종목으로 이미 들어가 있어서 다시 더하지 않아요. 앞으로 받을 연금은 "예상 월 연금액"에 따로 보여드려요.',
  ],
  pnl: '보유 종목의 평가금액에서 매입금액(평단가 × 수량)을 뺀 금액이에요. 공제회·예적금·연금은 넣지 않아요.',
  pension: '연금마다 받기 시작할 때의 월 수령액을 지금 돈 가치(현재가치)로 바꿔 더한 금액이에요. 총자산에는 넣지 않아요.',
  netWorth: [
    '순자산 = 총자산(금융자산) + 부동산 − 대출이에요. 빚을 뺀 내 재산이에요.',
    '부동산은 직접 적은 시세, 대출은 기준일 금액에서 갚은 만큼 뺀 오늘 남은 원금으로 계산해요.',
  ],
  loanPayment: '대출마다 다음에 갚을 돈(원금 + 이자)을 더한 금액이에요. 원리금균등은 매달 같고, 원금균등은 점점 줄어요.',
  dividend: [
    '보유 종목의 "1주당 연 배당금 × 수량"을 더한 올해 예상 배당금이에요. 1주당 연 배당금은 작년 1년 동안 실제로 받은 배당을 더한 값을 써요(시트 연결 시 자동).',
    '종목 수정에서 "직접 적기"를 켠 종목은 적은 값을 써요. 배당수익률은 연 배당금 ÷ 투자자산이에요. 실제 배당은 회사 사정에 따라 달라질 수 있어요.',
  ],
  score: '주식이 한쪽에 쏠리지 않고 잘 나뉘어 있는지 100점 만점으로 매긴 점수예요. 항목별 점수와 이유는 분산 분석에서 볼 수 있어요.',
  trend: [
    '한 달에 한 번 그때의 총자산을 기록해 두고 막대로 보여드려요. 같은 달에 다시 기록하면 그 달 기록을 바꿔요.',
    '기록은 이 기기의 브라우저에만 저장돼요.',
  ],
};

const ALERT_KINDS = { sector: '섹터', country: '국가', single: '한 종목' };

// 총자산 금액은 가려 두고 누르면 보여 준다. 앱을 새로 열면 다시 가린다 (탭을 옮겨도 이번에 연 동안은 유지).
let totalRevealed = false;
const MASK = '••••••';

function eyeIcon(open) {
  const parts = [
    svg('path', { d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z' }),
    svg('circle', { cx: '12', cy: '12', r: '3' }),
  ];
  if (!open) parts.push(svg('path', { d: 'M3 3l18 18' }));
  return svg('svg', { class: 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, ...parts);
}

// '2026-10' → '2026.10' (그래프 가로축)
const shortMonth = (month) => month.replace('-', '.');

function tile({ label, help, value, valueClass = '', subs = [], link = null }) {
  return el('section', { class: 'card kpi', 'aria-label': label },
    el('p', { class: 'stat-label' }, label, help ? helpTip(label, help) : null),
    el('p', { class: `stat-value ${valueClass}`.trim(), text: value }),
    subs.filter(Boolean).map((sub) => el('p', { class: 'stat-sub', text: sub })),
    link ? el('a', { class: 'kpi-link', href: link.href, text: link.text }) : null);
}

// 총자산과 투자자산·기타 금융자산 나눔 (가는 막대 + 목록). 가려 두면 금액 대신 '누르면 보여요' 버튼과 비율만.
// realEstate: 부동산 합계, includeRealEstate: 총자산에 부동산을 넣을지 (부동산이 있으면 고르는 버튼을 보여 준다)
function heroCard(summary, money, { revealed, onToggle, realEstate = 0, includeRealEstate = false, onIncludeChange }) {
  const withHouse = includeRealEstate && realEstate > 0;
  const total = summary.total + (withHouse ? realEstate : 0);
  const parts = [
    { name: '투자자산', value: summary.invested, color: 'series-1' },
    { name: '기타 금융자산', value: summary.others, color: 'series-2' },
    ...(withHouse ? [{ name: '부동산', value: realEstate, color: 'series-3' }] : []),
  ];
  const share = (value) => (total > 0 ? value / total : 0);
  const amount = (value) => (revealed ? money(value) : MASK);
  let scope = null;
  if (realEstate > 0) {
    const control = segmented({
      options: [['exclude', '부동산 빼고'], ['include', '부동산 포함']],
      value: withHouse ? 'include' : 'exclude',
      onChange: (next) => onIncludeChange?.(next === 'include'),
    });
    control.element.classList.add('hero-scope');
    control.element.setAttribute('aria-label', '총자산에 부동산(집값)을 넣을지');
    scope = control.element;
  }
  const value = revealed
    ? el('p', { class: 'hero-value', text: money(total) })
    : el('button', { type: 'button', class: 'hero-reveal', 'aria-label': '총자산 금액 보기', onClick: onToggle },
      el('span', { class: 'hero-mask', 'aria-hidden': 'true', text: `${MASK}원` }),
      el('span', { class: 'hero-reveal-hint' }, eyeIcon(true), '확인하려면 누르세요'));
  return el('section', { class: 'card dash-hero', 'aria-label': '총자산' },
    el('div', { class: 'hero-head' },
      el('p', { class: 'hero-label' }, withHouse ? '총자산 (부동산 포함)' : '총자산', helpTip('총자산', HELP.total)),
      revealed
        ? el('button', { type: 'button', class: 'btn btn-small hero-hide', 'aria-label': '총자산 금액 가리기', onClick: onToggle }, eyeIcon(false), '가리기')
        : null),
    scope,
    value,
    total > 0
      ? el('div', {
        class: 'split-bar',
        role: 'img',
        'aria-label': parts.map((part) => `${part.name} ${formatPercentShort(share(part.value))}`).join(', '),
      }, parts.filter((part) => part.value > 0).map((part) => el('span', {
        style: `flex: ${share(part.value) * 100} 1 0; background: var(--${part.color})`,
      })))
      : null,
    el('ul', { class: 'split-legend' }, parts.map((part) => el('li', {},
      el('span', { class: 'swatch', style: `background: var(--${part.color})`, 'aria-hidden': 'true' }),
      el('span', { class: 'split-name', text: part.name }),
      el('span', { class: 'split-value', text: amount(part.value) }),
      total > 0 ? el('span', { class: 'muted', text: formatPercentShort(share(part.value)) }) : null))),
    summary.cash > 0
      ? el('p', { class: 'muted small', text: revealed ? `투자자산에는 예수금 ${money(summary.cash)}이 들어 있어요.` : '투자자산에는 예수금이 들어 있어요.' })
      : null);
}

// 순자산: 총자산 + 부동산 − 대출. 총자산처럼 가려 두고 누르면 보여 준다.
function netWorthCard(worth, money, { revealed, onToggle, includeRealEstate = false }) {
  const amount = (value) => (revealed ? money(value) : MASK);
  const rows = includeRealEstate && worth.realEstate > 0
    ? [
      ['총자산 (부동산 포함)', amount(worth.financial + worth.realEstate), ''],
      ['대출 (남은 원금)', amount(worth.loans), '−'],
    ]
    : [
      ['총자산 (금융자산)', amount(worth.financial), ''],
      ['부동산', amount(worth.realEstate), '+'],
      ['대출 (남은 원금)', amount(worth.loans), '−'],
    ];
  return el('section', { class: 'card dash-networth', 'aria-label': '순자산' },
    el('p', { class: 'hero-label' }, '순자산', helpTip('순자산', HELP.netWorth)),
    revealed
      ? el('p', { class: 'networth-value num', text: money(worth.total) })
      : el('button', { type: 'button', class: 'hero-reveal networth-reveal', 'aria-label': '순자산 금액 보기', onClick: onToggle },
        el('span', { class: 'hero-mask', 'aria-hidden': 'true', text: `${MASK}원` }),
        el('span', { class: 'hero-reveal-hint' }, eyeIcon(true), '확인하려면 누르세요')),
    el('dl', { class: 'networth-rows' }, rows.map(([label, value, sign]) => el('div', { class: 'networth-row' },
      el('dt', {}, sign ? el('span', { class: 'networth-sign', 'aria-hidden': 'true', text: sign }) : null, label),
      el('dd', { class: 'num', text: value })))),
    el('a', { class: 'kpi-link', href: '#others', text: '부동산·대출 보기' }));
}

// 매달 갚는 돈: 대출마다 다음 회차(원금 + 이자) 합계와 가장 늦게 다 갚는 날
function loanTile(loans, money) {
  const months = loans.lastPayoffDate ? Math.max(0, parseMonth(loans.lastPayoffDate) - currentMonthIndex()) : null;
  return tile({
    label: '매달 갚는 돈',
    help: HELP.loanPayment,
    value: `월 ${money(loans.monthlyPayment)}`,
    subs: [
      `원금 ${formatMoney(loans.monthlyPrincipal, { unit: 'won' })} · 이자 ${formatMoney(loans.monthlyInterest, { unit: 'won' })}`,
      loans.lastPayoffDate ? `대출 ${loans.items.length}건 · 다 갚는 날 ${formatMonthIndex(parseMonth(loans.lastPayoffDate))} (앞으로 ${durationText(months)})` : `대출 ${loans.items.length}건`,
    ],
    link: { href: '#others', text: '대출 보기' },
  });
}

function pnlTile(state, portfolio, money) {
  if (state.holdings.length === 0) {
    return tile({ label: '평가손익', help: HELP.pnl, value: EMPTY, subs: ['보유 종목을 입력하면 보여요.'], link: { href: '#holdings', text: '보유 종목 입력하기' } });
  }
  return tile({
    label: '평가손익',
    help: HELP.pnl,
    value: formatMoney(portfolio.totalPnl, { unit: state.settings.displayUnit, signed: true }),
    valueClass: pnlClass(portfolio.totalPnl),
    subs: [`수익률 ${formatPercent(portfolio.totalReturn, { signed: true })}`, `매입금액 ${money(portfolio.totalCost)}`],
    link: { href: '#holdings', text: '보유 종목 보기' },
  });
}

function pensionTile(state, plans, nowMonth, money) {
  const s = state.settings;
  const base = { label: '예상 월 연금액', help: HELP.pension };
  if (state.pensions.length === 0) {
    return tile({ ...base, value: EMPTY, subs: ['연금을 추가하면 보여요.'], link: { href: '#others', text: '연금 추가하기' } });
  }
  if (!s.birthYear) {
    return tile({ ...base, value: EMPTY, subs: ['설정에 출생연도를 넣으면 계산해요.'], link: { href: '#settings', text: '설정으로 가기' } });
  }
  const summary = pensionSummary(plans, { nowMonth, inflationRate: s.inflationRate });
  if (summary.count === 0) {
    return tile({ ...base, value: EMPTY, subs: ['앞으로 받을 연금이 없어요. 수령 개시 연령과 받는 기간을 확인해 주세요.'], link: { href: '#others', text: '기타 자산 보기' } });
  }
  const { first } = summary;
  const firstText = first.startMonth <= nowMonth
    ? `${first.name} 지금 받는 중`
    : `첫 연금 ${formatMonthIndex(first.startMonth)}(${ageAt(first.startMonth, s.birthYear, s.birthMonth)}세)부터`;
  return tile({
    ...base,
    value: `월 ${money(summary.monthlyTotal)}`,
    subs: [`현재가치 · 연금 ${summary.count}개 합계`, firstText],
    link: { href: '#forecast', text: '미래 예측 보기' },
  });
}

function dividendTile(state, portfolio, money) {
  const base = { label: '예상 연 배당금', help: HELP.dividend };
  if (!(portfolio.annualDividend > 0)) {
    return tile({
      ...base,
      value: EMPTY,
      subs: [state.holdings.length === 0 ? '보유 종목을 입력하면 보여요.'
        : state.settings.sheetUrl ? '작년에 배당을 받은 종목이 아직 없어요.' : '구글 시트를 연결하면 작년 배당금을 자동으로 넣어요.'],
      link: { href: '#holdings', text: '보유 종목 보기' },
    });
  }
  return tile({
    ...base,
    value: `연 ${money(portfolio.annualDividend)}`,
    subs: [
      `월 평균 약 ${money(portfolio.annualDividend / 12)}`,
      portfolio.dividendYield != null ? `배당수익률 ${formatPercent(portfolio.dividendYield)}` : null,
      dividendBasis(portfolio),
    ],
    link: { href: '#holdings', text: '보유 종목 보기' },
  });
}

function healthCard({ score, alerts }) {
  const titleId = uid('health-title');
  const section = el('section', { class: 'card dash-health', 'aria-labelledby': titleId },
    el('div', { class: 'score-head' },
      el('h2', { class: 'section-title', id: titleId, text: '포트폴리오 건강도' }),
      helpTip('포트폴리오 건강도', HELP.score)));
  if (!score) {
    section.append(
      el('p', { class: 'muted', text: '보유 종목을 입력하면 주식이 얼마나 고르게 나뉘어 있는지 점수로 보여드려요.' }),
      el('a', { class: 'kpi-link', href: '#holdings', text: '보유 종목 입력하기' }));
    return section;
  }
  section.append(scoreGauge(score, { size: 'small' }));
  if (alerts.length === 0) {
    section.append(el('p', { class: 'alert-clear' }, el('span', { class: 'badge badge-ok', text: '양호' }), ' 기준을 넘는 쏠림이 없어요.'));
  } else {
    section.append(
      el('p', { class: 'dash-subhead' }, '쏠림 경고 ', el('span', { class: 'badge badge-warn', text: `${alerts.length}건` })),
      el('ul', { class: 'dash-alerts' }, alerts.map((alert) => el('li', {},
        el('span', { class: 'badge badge-warn badge-tiny', text: ALERT_KINDS[alert.kind] }),
        el('span', { text: `${alert.name} ${formatPercentShort(alert.weight)}` })))));
  }
  section.append(el('a', { class: 'kpi-link', href: '#analysis', text: '분산 분석에서 자세히 보기' }));
  return section;
}

// 1년 넘게 고치지 않은 공제회·예적금·연금·부동산·대출(갱신 알림), 원금이 줄지 않는 대출, 시세 문제
function checkItems(state, portfolio, loans) {
  const items = [];
  for (const { loan, status } of loans.items) {
    if (status.error !== 'too-small') continue;
    items.push({ text: `${loan.name}: 매월 상환액이 이자보다 적어서 원금이 줄지 않아요. 금액을 확인해 주세요.`, href: '#others', linkText: '대출 고치기' });
  }
  for (const item of [...state.otherAssets, ...state.pensions, ...state.realEstate, ...state.loans]) {
    if (!isOlderThan(item.updatedAt, STALE_AFTER_DAYS)) continue;
    items.push({
      text: `${item.name}: 마지막으로 고친 지 1년이 넘었어요(${formatDate(item.updatedAt)}). 업데이트할 때가 됐어요.`,
      href: '#others',
      linkText: '기타 자산에서 고치기',
    });
  }
  if (portfolio.avgPriceCount > 0) {
    items.push({
      text: `현재가가 없는 종목 ${portfolio.avgPriceCount}개는 평단가로 계산하고 있어요. 이 종목들의 손익은 0원으로 보여요.`,
      href: '#holdings',
      linkText: '보유 종목 확인하기',
    });
  }
  if (portfolio.missingFxCount > 0) {
    items.push({
      text: `달러 환율이 없어서 달러 종목 ${portfolio.missingFxCount}개가 총자산에서 빠졌어요.`,
      href: '#settings',
      linkText: '설정에서 환율 넣기',
    });
  }
  return items;
}

function checksCard(items) {
  const titleId = uid('checks-title');
  return el('section', { class: 'card dash-checks', 'aria-labelledby': titleId },
    el('h2', { class: 'section-title', id: titleId }, '확인할 것',
      items.length > 0 ? el('span', { class: 'badge badge-warn', text: `${items.length}건` }) : null),
    items.length === 0
      ? el('p', { class: 'alert-clear' }, el('span', { class: 'badge badge-ok', text: '양호' }), ' 지금은 확인할 것이 없어요.')
      : el('ul', { class: 'check-list' }, items.map((item) => el('li', {},
        el('p', { text: item.text }),
        el('a', { href: item.href, text: item.linkText })))));
}

export function render(root, { getState, updateState, subscribe }) {
  let chart = null;
  let drawCount = 0;

  const destroyChart = () => {
    chart?.destroy();
    chart = null;
  };

  const moneyOf = (state) => (value) => formatMoney(value, { unit: state.settings.displayUnit });

  function currentValues() {
    const state = getState();
    const market = getMarket(state);
    const portfolio = valuePortfolio(state.holdings, { prices: market.prices, fxRate: market.fx.rate, dividends: market.dividends });
    const cash = cashInKRW(state.cash, market.fx.rate);
    // 공제회·예적금은 기준일 금액에서 납입·이자를 더한 오늘 추정 금액
    const summary = assetSummary({
      rows: portfolio.rows, otherAssets: state.otherAssets, pensions: state.pensions, cashByAccount: cash.byAccount, nowMonth: currentMonthIndex(),
    });
    return { state, portfolio, summary, cash };
  }

  // 이번 달 기록 남기기. 같은 달 기록이 있거나 계산에 문제가 있으면 먼저 물어본다.
  async function saveSnapshot() {
    const { state, portfolio, summary } = currentValues();
    const money = moneyOf(state);
    const snapshot = createSnapshot(summary);
    const monthText = formatYearMonth(snapshot.month);
    const notes = [];
    if (portfolio.avgPriceCount > 0) notes.push(`현재가가 없는 종목 ${portfolio.avgPriceCount}개는 평단가로 기록돼요.`);
    if (portfolio.missingFxCount > 0) notes.push(`달러 환율이 없어서 달러 종목 ${portfolio.missingFxCount}개는 빠진 채로 기록돼요.`);
    const existing = state.snapshots.find((item) => item.month === snapshot.month);
    if (existing || notes.length > 0) {
      const now = money(snapshot.total);
      const old = existing ? money(existing.total) : '';
      const question = existing
        ? `${monthText} 기록(${old})을 지금 총자산 ${now}${josa(now, '으로', '로')} 바꿀까요?`
        : `${monthText} 기록으로 지금 총자산 ${now}${josa(now, '을', '를')} 남길까요?`;
      const confirmed = await confirmDialog({
        title: `${monthText} 기록`, message: [question, ...notes].join(' '), confirmText: existing ? '바꾸기' : '기록하기',
      });
      if (!confirmed) return;
    }
    updateState((draft) => {
      draft.snapshots = upsertSnapshot(draft.snapshots, snapshot);
      draft.meta.snapshotPromptMonth = snapshot.month;
    });
    showToast(`${monthText} 기록을 남겼어요`);
  }

  async function removeSnapshot(month) {
    const confirmed = await confirmDialog({
      title: '기록 삭제', message: `${formatYearMonth(month)} 기록을 삭제할까요? 삭제하면 되돌릴 수 없어요.`, confirmText: '삭제', danger: true,
    });
    if (!confirmed) return;
    updateState((draft) => { draft.snapshots = draft.snapshots.filter((item) => item.month !== month); });
    showToast('삭제했어요');
  }

  function trendCard({ snapshots, thisMonth, money, loading, settings, onReveal }) {
    const titleId = uid('trend-title');
    const hasThisMonth = snapshots.some((item) => item.month === thisMonth);
    const saveButton = el('button', {
      type: 'button',
      class: 'btn btn-small',
      text: loading ? '시세 받는 중…' : (hasThisMonth ? '이번 달 다시 기록' : '이번 달 기록하기'),
      disabled: loading,
      onClick: saveSnapshot,
    });
    const section = el('section', { class: 'card dash-trend', 'aria-labelledby': titleId },
      el('div', { class: 'trend-head' },
        el('div', { class: 'score-head' },
          el('h2', { class: 'section-title', id: titleId, text: '총자산 추이' }),
          helpTip('총자산 추이', HELP.trend)),
        saveButton));

    if (snapshots.length === 0) {
      section.append(el('p', { class: 'muted', text: '아직 기록이 없어요. 한 달에 한 번 기록하면 총자산이 어떻게 변하는지 막대 그래프로 보여드려요.' }));
      return { element: section, canvas: null };
    }
    // 총자산을 가려 둔 동안은 추이(금액)도 가린다
    if (!totalRevealed) {
      section.append(el('div', { class: 'trend-masked' },
        el('p', { class: 'muted', text: `기록 ${snapshots.length}개가 있어요. 금액을 가려 두어서 추이도 함께 가렸어요.` }),
        el('button', { type: 'button', class: 'btn btn-small', onClick: onReveal }, eyeIcon(true), '금액 보기')));
      return { element: section, canvas: null };
    }

    const change = latestChange(snapshots);
    if (change) {
      const signedMoney = formatMoney(change.change, { unit: settings.displayUnit, signed: true });
      section.append(el('p', { class: 'trend-change' },
        `${formatYearMonth(change.latest.month)} 기록은 ${formatYearMonth(change.previous.month)}보다 `,
        el('strong', { class: pnlClass(change.change), text: signedMoney }),
        change.rate != null ? ` (${formatPercent(change.rate, { signed: true })})` : ''));
    } else {
      section.append(el('p', { class: 'muted small', text: `${formatYearMonth(snapshots[0].month)}에 처음 기록했어요. 다음 달에 한 번 더 기록하면 변화가 보여요.` }));
    }

    const canvas = el('canvas');
    const frame = el('div', { class: 'chart-frame', style: 'height: 240px' }, canvas);
    const legend = el('ul', { class: 'chart-legend' },
      el('li', {}, el('span', { class: 'swatch', style: 'background: var(--series-1)', 'aria-hidden': 'true' }), '투자자산'),
      el('li', {}, el('span', { class: 'swatch', style: 'background: var(--series-2)', 'aria-hidden': 'true' }), '기타 금융자산'));
    const fallback = el('p', { class: 'muted small', hidden: true, text: '차트 도구를 불러오지 못해 아래 표로만 보여드려요.' });

    const newestFirst = [...snapshots].reverse();
    const table = el('details', { class: 'table-details' },
      el('summary', { text: `기록 표로 보기 (${snapshots.length}개)` }),
      el('div', { class: 'table-wrap' }, el('table', { class: 'table snapshot-table' },
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col', text: '기록한 달' }),
          el('th', { scope: 'col', class: 'num', text: '총자산' }),
          el('th', { scope: 'col', class: 'num', text: '투자자산' }),
          el('th', { scope: 'col', class: 'num', text: '기타 금융자산' }),
          el('th', { scope: 'col' }, el('span', { class: 'visually-hidden', text: '삭제' })))),
        el('tbody', {}, newestFirst.map((item) => el('tr', {},
          el('th', { scope: 'row' }, el('div', { text: formatYearMonth(item.month) }), el('div', { class: 'cell-sub', text: `${formatDate(item.date)} 기록` })),
          el('td', { class: 'num', text: money(item.total) }),
          el('td', { class: 'num', text: money(item.invested) }),
          el('td', { class: 'num', text: money(item.others) }),
          el('td', { class: 'cell-action' }, el('button', {
            type: 'button', class: 'btn btn-small', text: '삭제', 'aria-label': `${formatYearMonth(item.month)} 기록 삭제`, onClick: () => removeSnapshot(item.month),
          }))))))));

    section.append(legend, frame, fallback, table);
    return { element: section, canvas, frame, fallback };
  }

  function draw() {
    destroyChart();
    clear(root);
    drawCount += 1;
    const current = drawCount;
    const { state, portfolio, summary } = currentValues();
    const s = state.settings;
    const money = moneyOf(state);
    const nowMonth = currentMonthIndex();
    const thisMonth = toYearMonth(nowMonth);

    if (state.holdings.length + state.otherAssets.length + state.pensions.length + state.realEstate.length + state.loans.length === 0) {
      root.append(el('section', { class: 'card empty-state' },
        el('p', { class: 'empty-title', text: '아직 입력한 자산이 없어요' }),
        el('p', { class: 'muted', text: '보유 종목과 공제회·예적금·연금을 입력하면 총자산, 손익, 예상 연금, 건강도 점수를 여기서 한눈에 보여드려요.' }),
        el('div', { class: 'toolbar' },
          el('a', { class: 'btn btn-primary', href: '#holdings', text: '보유 종목 입력하기' }),
          el('a', { class: 'btn', href: '#others', text: '기타 자산 입력하기' }))));
      return;
    }

    // ── 이번 달 기록 제안 (시세를 받는 중이면 다 받은 뒤에) ──
    const loading = getPriceStatus().state === 'loading';
    if (!loading && shouldSuggestSnapshot({ snapshots: state.snapshots, promptMonth: state.meta.snapshotPromptMonth, month: thisMonth, total: summary.total })) {
      const total = money(summary.total);
      const what = totalRevealed ? `지금 총자산 ${total}${josa(total, '을', '를')}` : '지금 총자산을';
      root.append(el('section', { class: 'card snapshot-prompt', 'aria-label': '이번 달 기록' },
        el('div', {},
          el('p', { class: 'snapshot-prompt-title', text: `${formatYearMonth(thisMonth)} 기록을 남길까요?` }),
          el('p', { class: 'muted small', text: `${what} 기록해 두면 달마다 어떻게 변하는지 그래프로 볼 수 있어요.` })),
        el('div', { class: 'toolbar' },
          el('button', { type: 'button', class: 'btn btn-primary', text: '기록하기', onClick: saveSnapshot }),
          el('button', {
            type: 'button',
            class: 'btn',
            text: '이번 달은 넘어가기',
            onClick: () => updateState((draft) => { draft.meta.snapshotPromptMonth = thisMonth; }),
          }))));
    }

    // ── 총자산과 요약 숫자 ──
    const plans = planPensions(state.pensions, { settings: s, accountValues: valueByAccount(portfolio.rows, cashInKRW(state.cash, getMarket(state).fx.rate).byAccount), nowMonth });
    const toggleTotal = () => {
      totalRevealed = !totalRevealed;
      draw();
      root.querySelector(totalRevealed ? '.hero-hide' : '.hero-reveal')?.focus();
    };
    const loans = loansSummary(state.loans);
    const hasWorthItems = state.realEstate.length > 0 || state.loans.length > 0;
    const houses = realEstateTotal(state.realEstate);
    const includeRealEstate = s.totalIncludesRealEstate;
    root.append(heroCard(summary, money, {
      revealed: totalRevealed,
      onToggle: toggleTotal,
      realEstate: houses,
      includeRealEstate,
      onIncludeChange: (next) => {
        updateState((draft) => { draft.settings.totalIncludesRealEstate = next; });
        root.querySelector('.hero-scope input:checked')?.focus();
      },
    }));
    // 부동산이나 대출을 적었으면 순자산(총자산 + 부동산 − 대출)
    if (hasWorthItems) {
      root.append(netWorthCard(netWorth({ financial: summary.total, realEstate: houses, loans: loans.balance }), money, { revealed: totalRevealed, onToggle: toggleTotal, includeRealEstate }));
    }
    root.append(
      el('div', { class: 'kpi-grid' },
        pnlTile(state, portfolio, money),
        pensionTile(state, plans, nowMonth, money),
        dividendTile(state, portfolio, money),
        state.loans.length > 0 ? loanTile(loans, money) : null));

    // ── 건강도·쏠림 경고, 확인할 것 ──
    const stocks = analyzeDiversification(portfolio.rows);
    const score = stocks.stockTotal > 0 ? scorePortfolio(portfolio.rows, s) : null;
    const alerts = score ? concentrationAlerts({ ...stocks, holdings: holdingWeights(portfolio.rows) }, s) : [];
    root.append(el('div', { class: 'dash-grid' }, healthCard({ score, alerts }), checksCard(checkItems(state, portfolio, loans))));

    // ── 총자산 추이 ──
    const trend = trendCard({ snapshots: state.snapshots, thisMonth, money, loading, settings: s, onReveal: toggleTotal });
    root.append(trend.element);
    if (trend.canvas) {
      const snapshots = state.snapshots;
      const labels = snapshots.map((item) => shortMonth(item.month));
      const summaryText = snapshots.slice(-6).map((item) => `${shortMonth(item.month)} ${money(item.total)}`).join(', ');
      loadChartLibrary()
        .then((Chart) => {
          if (current !== drawCount) return;
          chart = renderTrendChart(Chart, trend.canvas, {
            labels,
            invested: snapshots.map((item) => item.invested),
            others: snapshots.map((item) => item.others),
            money,
            label: `총자산 추이: ${summaryText}`,
          });
        })
        .catch(() => {
          if (current !== drawCount) return;
          trend.frame.remove();
          trend.fallback.hidden = false;
        });
    }
  }

  // 시스템 다크 모드가 바뀌면 차트 색을 다시 칠한다.
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const redraw = () => draw();
  darkQuery.addEventListener('change', redraw);

  draw();
  const unsubscribeState = subscribe(redraw);
  const unsubscribeMarket = subscribeMarket(redraw);
  return () => {
    unsubscribeState();
    unsubscribeMarket();
    darkQuery.removeEventListener('change', redraw);
    destroyChart();
  };
}
