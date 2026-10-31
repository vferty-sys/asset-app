// 미래 예측 탭: 퇴직 시점 종합, 은퇴 후 월 소득 타임라인과 소득 공백기, 연금별 요약, 공제회·예적금 시나리오 그래프
// 모든 금액은 '미래 금액(그때 실제 금액)' 또는 '현재가치(지금 돈 가치)'로 바꿔 볼 수 있다.

import { PENSION_KIND_LABELS } from '../constants.js';
import { valuePortfolio } from '../calc/valuation.js';
import {
  coverageYears, incomeGap, incomeTimeline, planPension, projectOtherAsset, retirementProjection, toFutureValue,
  toPresentValue, valueAt, yearlySamples,
} from '../calc/projection.js';
import { loadChartLibrary, renderFanChart, renderIncomeChart } from '../charts.js';
import { ageAt, currentMonthIndex, durationText, formatMonthIndex, parseMonth, yearOf } from '../dates.js';
import { getMarket, subscribeMarket } from '../market.js';
import { el, clear, helpTip } from '../dom.js';
import { formatMoney, formatNumber, josa } from '../format.js';
import { segmented } from './form.js';

const MAX_COLORS = 6;
const HELP = {
  view: [
    '미래 금액: 그때 실제로 갖게 될(받게 될) 돈이에요.',
    '현재가치: 물가가 오르는 만큼 할인해서 "지금 돈으로 치면 얼마인지"로 바꾼 값이에요. 생활비와 비교할 때는 현재가치가 알기 쉬워요.',
  ],
  gap: '퇴직한 뒤 첫 연금이 나오기 전까지 월급도 연금도 없는 기간이에요. 이 동안은 모아 둔 돈으로 생활해야 해요.',
};

// 탭을 오가도 유지 (앱을 닫으면 처음 값)
let view = 'present';

const pct = (value) => `${formatNumber(value, { maximumFractionDigits: 2 })}%`;

function rateRange(rates) {
  return rates.low === rates.base && rates.base === rates.high
    ? pct(rates.base)
    : `${pct(rates.low)} / ${pct(rates.base)} / ${pct(rates.high)} (낮음 / 기준 / 높음)`;
}

// 공제회·예적금 카드의 세금 가정 문구
function depositTaxNote(asset) {
  if (!asset.applyTax) return '이자에 붙는 세금은 빼지 않았어요';
  return asset.accruedInterest > 0
    ? `이자(지금까지 붙은 이자 포함)에서 세금 ${pct(asset.taxRate)}를 뺐어요`
    : `앞으로 붙을 이자에서 세금 ${pct(asset.taxRate)}를 뺐어요(지금까지 붙은 이자를 넣으면 그 세금도 계산해요)`;
}

function stat(label, value, sub, main = false) {
  return el('div', { class: `stat${main ? ' stat-main' : ''}` },
    el('p', { class: 'stat-label', text: label }),
    el('p', { class: 'stat-value', text: value }),
    sub ? el('p', { class: 'stat-sub', text: sub }) : null);
}

function chartFrame(canvas, height) {
  return el('div', { class: 'chart-frame', style: `height: ${height}px` }, canvas);
}

export function render(root, { getState, subscribe }) {
  let charts = [];
  let drawCount = 0;

  const destroyCharts = () => {
    charts.forEach((chart) => chart.destroy());
    charts = [];
  };

  function draw({ focusToggle = false } = {}) {
    destroyCharts();
    clear(root);
    drawCount += 1;
    const current = drawCount;
    const state = getState();
    const s = state.settings;
    const nowMonth = currentMonthIndex();
    const money = (value) => formatMoney(value, { unit: s.displayUnit });
    const viewLabel = view === 'present' ? '현재가치' : '미래 금액';
    // 그 달의 실제 금액을 지금 고른 보기로
    const show = (amount, month) => (view === 'present' ? toPresentValue(amount, month - nowMonth, s.inflationRate) : amount);
    const pendingCharts = [];

    // ── 보기 전환 ──
    const toggle = segmented({
      options: [['future', '미래 금액'], ['present', '현재가치']],
      value: view,
      onChange: (value) => {
        view = value;
        draw({ focusToggle: true });
      },
    });
    toggle.element.setAttribute('aria-label', '금액 보기');
    root.append(el('div', { class: 'forecast-controls' }, toggle.element, helpTip('미래 금액과 현재가치', HELP.view)));

    if (state.holdings.length === 0 && state.otherAssets.length === 0 && state.pensions.length === 0) {
      root.append(el('section', { class: 'card empty-state' },
        el('p', { class: 'empty-title', text: '예측할 자산이 없어요' }),
        el('p', { class: 'muted', text: '보유 종목, 공제회·예적금, 연금을 입력하면 퇴직할 때 얼마나 모일지, 은퇴 후 매달 얼마를 받을지 계산해 드려요.' }),
        el('div', { class: 'toolbar' },
          el('a', { class: 'btn btn-primary', href: '#others', text: '기타 자산 입력하기' }),
          el('a', { class: 'btn', href: '#holdings', text: '보유 종목 입력하기' }))));
      return;
    }

    const hasPerson = Boolean(s.birthYear);
    const retirementMonth = parseMonth(s.retirementDate);
    if (!hasPerson || retirementMonth == null) {
      root.append(el('p', { class: 'banner banner-warn' },
        '퇴직 시점 종합과 은퇴 후 월 소득을 보려면 ', el('a', { href: '#settings', text: '설정' }), '에서 출생연도와 퇴직(목표) 시점을 입력해 주세요.'));
    }

    // 계좌에 연결한 적립형 연금의 종목은 연금으로 계산하므로 주식에서 뺀다 (이중 계산 방지)
    const market = getMarket(state);
    const { rows } = valuePortfolio(state.holdings, { prices: market.prices, fxRate: market.fx.rate });
    const accountValues = {};
    for (const row of rows) {
      if (row.valueKRW > 0) accountValues[row.holding.account] = (accountValues[row.holding.account] ?? 0) + row.valueKRW;
    }
    const linkedAccounts = [...new Set(state.pensions.filter((p) => p.kind === 'accumulating' && p.linkedAccount).map((p) => p.linkedAccount))];
    const stockValue = rows.filter((row) => row.valueKRW > 0 && !linkedAccounts.includes(row.holding.account)).reduce((sum, row) => sum + row.valueKRW, 0);
    const linkedValue = linkedAccounts.reduce((sum, account) => sum + (accountValues[account] ?? 0), 0);

    const plannable = hasPerson ? state.pensions.filter((pension) => pension.startAge != null) : [];
    const plans = plannable.map((pension) => planPension(pension, {
      birthYear: s.birthYear,
      birthMonth: s.birthMonth,
      lifeExpectancy: s.lifeExpectancy,
      nowMonth,
      inflationRate: s.inflationRate,
      taxRate: s.pensionTaxRate,
      linkedBalance: accountValues[pension.linkedAccount] ?? 0,
    }));
    const paying = plans.filter((plan) => plan.months > 0);

    // ── 퇴직(목표) 시점 종합 ──
    if (hasPerson && retirementMonth != null) {
      const projection = retirementProjection({
        stockValue,
        monthlyInvestment: s.stockMonthlyInvestment,
        stockReturns: { low: s.stockReturnLow, base: s.stockReturnBase, high: s.stockReturnHigh },
        otherAssets: state.otherAssets,
        plans,
        retirementMonth,
        nowMonth,
      });
      const at = (amount) => show(amount, retirementMonth);
      const pensionTotal = paying.reduce((sum, plan) => sum + show(plan.startAmount.base, plan.startMonth), 0);
      const byType = Object.entries(projection.deposits.byType).map(([type, amount]) => `${type} ${money(at(amount))}`).join(' · ');
      const until = retirementMonth > nowMonth ? `앞으로 ${durationText(retirementMonth - nowMonth)}` : '이미 지난 시점이에요';
      const notes = [
        `주식: 지금 ${money(stockValue)}에 매달 ${money(s.stockMonthlyInvestment)}씩 더해 연 ${pct(s.stockReturnLow)} / ${pct(s.stockReturnBase)} / ${pct(s.stockReturnHigh)}로 굴린다고 계산했어요.`,
        linkedValue > 0 ? `${linkedAccounts.join('·')} 계좌의 종목 ${money(linkedValue)}은 연금으로 계산해서 주식에서 뺐어요.` : null,
        `공제회·예적금은 항목마다 입력한 기준 이율로 계산했고, 퇴직 전에 받는 돈은 그대로 들고 있다고 봤어요.${state.otherAssets.some((asset) => asset.applyTax) ? ' 세금 빼기를 켠 항목은 이자에서 세금을 뺐어요.' : ''}`,
        view === 'present' ? `현재가치는 물가상승률 연 ${pct(s.inflationRate)}로 지금 돈 가치로 바꾼 금액이에요.` : null,
      ].filter(Boolean);
      root.append(el('section', { class: 'card summary-card forecast-summary', 'aria-label': '퇴직 시점 종합 예측' },
        el('div', { class: 'stat-main' },
          el('h2', { class: 'section-title', text: '퇴직(목표) 시점 종합 예측' }),
          el('p', { class: 'muted small', text: `${formatMonthIndex(retirementMonth)} · 만 ${ageAt(retirementMonth, s.birthYear, s.birthMonth)}세 · ${until} · ${viewLabel}` })),
        stat('퇴직 때 모은 돈 (기준)', money(at(projection.stocks.base + projection.deposits.base)), '주식 + 공제회·예적금', true),
        stat('주식', money(at(projection.stocks.base)), `낮음 ${money(at(projection.stocks.low))} ~ 높음 ${money(at(projection.stocks.high))}`),
        stat('공제회·예적금', money(at(projection.deposits.base)), state.otherAssets.length > 0 ? byType : '입력한 항목이 없어요'),
        stat('연금 월 수령액 합계', paying.length > 0 ? `월 ${money(pensionTotal)}` : '–',
          paying.length > 0 ? '모든 연금이 나오기 시작한 뒤 · 각 연금 시작 시점 금액' : '입력한 연금이 없어요'),
        el('ul', { class: 'summary-note forecast-notes' }, notes.map((note) => el('li', { text: note })))));
    }

    // ── 은퇴 후 월 소득 타임라인 + 소득 공백기 ──
    if (hasPerson) {
      const currentAge = ageAt(nowMonth, s.birthYear, s.birthMonth);
      const retireAge = retirementMonth != null ? ageAt(retirementMonth, s.birthYear, s.birthMonth) : null;
      const fromAge = Math.max(retireAge ?? currentAge, currentAge);
      const toAge = Math.max(s.lifeExpectancy, fromAge);
      const section = el('section', { class: 'card forecast-section', 'aria-label': '은퇴 후 월 소득' },
        el('h2', { class: 'section-title', text: '은퇴 후 월 소득' }),
        el('p', { class: 'muted small', text: `${fromAge}세부터 ${toAge}세까지 나이마다 받는 연금 (${viewLabel})` }));

      // 소득 공백기
      const gap = retirementMonth != null ? incomeGap(paying, retirementMonth) : null;
      const gapBox = el('div', { class: 'gap-box' });
      if (retirementMonth != null) {
        const depositsAtRetirement = state.otherAssets.reduce((sum, asset) => {
          const projection = projectOtherAsset(asset, { nowMonth, endMonth: retirementMonth });
          return sum + valueAt(projection.base, retirementMonth).balance;
        }, 0);
        // 생활비는 지금 돈 기준으로 입력하므로, 모은 돈도 지금 돈 가치로 바꿔서 비교한다
        const depositsToday = toPresentValue(depositsAtRetirement, retirementMonth - nowMonth, s.inflationRate);
        const years = coverageYears(depositsToday, s.monthlyLivingCost);
        const lines = [];
        let tone = 'info';
        if (gap.gapMonths == null) {
          lines.push('연금이 없어서 퇴직 뒤 생활비를 모두 모아 둔 돈으로 써야 해요.');
          tone = 'warn';
        } else if (gap.gapMonths === 0) {
          lines.push('퇴직하자마자 연금이 나와서 소득 공백기가 없어요.');
          tone = 'ok';
        } else {
          lines.push(`퇴직 뒤 ${durationText(gap.gapMonths)} 동안 연금이 없어요 (${formatMonthIndex(retirementMonth)} ~ ${formatMonthIndex(gap.firstStartMonth - 1)}).`);
        }
        if (gap.gapMonths !== 0) {
          if (years == null) {
            lines.push('설정에 퇴직 후 월 목표 생활비를 넣으면 모아 둔 돈으로 몇 년 버틸 수 있는지 알려드려요.');
          } else {
            const cost = money(s.monthlyLivingCost);
            lines.push(`공제회·예적금 ${money(depositsToday)}(현재가치 기준)이면 월 생활비 ${cost}${josa(cost, '을', '를')} 약 ${formatNumber(years, { maximumFractionDigits: 1 })}년 감당할 수 있어요.`);
            if (gap.gapMonths != null) {
              const short = gap.gapMonths / 12 - years;
              tone = short > 0 ? 'warn' : 'ok';
              lines.push(short > 0
                ? `공백기 중 약 ${formatNumber(short, { maximumFractionDigits: 1 })}년은 주식 등 다른 돈이 필요해요.`
                : '공백기를 공제회·예적금으로 버틸 수 있어요.');
            }
          }
        }
        gapBox.className = `gap-box banner banner-${tone}`;
        gapBox.append(el('p', { class: 'gap-title' }, el('strong', { text: '소득 공백기 ' }), helpTip('소득 공백기', HELP.gap)),
          ...lines.map((line) => el('p', { text: line })));
        section.append(gapBox);
      }

      if (paying.length === 0) {
        section.append(el('p', { class: 'muted', text: plannable.length === 0 ? '연금을 입력하면 나이마다 받는 월 소득을 보여드려요.' : '받을 수 있는 연금이 없어요(받는 기간이 끝났어요).' }),
          el('a', { class: 'btn btn-small', href: '#others', text: '연금 입력하기' }));
      } else {
        const timeline = incomeTimeline(paying, {
          birthYear: s.birthYear, birthMonth: s.birthMonth, fromAge, toAge, nowMonth, inflationRate: s.inflationRate, view,
        });
        const series = timeline.series.map((item, index) => ({ ...item, color: index < MAX_COLORS ? `series-${index + 1}` : 'series-other' }));
        const target = s.monthlyLivingCost > 0
          ? timeline.ages.map((age) => (view === 'present'
            ? s.monthlyLivingCost
            : toFutureValue(s.monthlyLivingCost, (age - currentAge) * 12, s.inflationRate)))
          : null;
        // 공백기: 퇴직(또는 지금)부터 첫 연금 시작 전 나이까지
        const gapEndIndex = gap?.gapMonths > 0 ? ageAt(gap.firstStartMonth - 1, s.birthYear, s.birthMonth) - fromAge : -1;
        const gapRange = gapEndIndex >= 0 ? { from: 0, to: Math.min(timeline.ages.length - 1, gapEndIndex) } : null;
        const totals = timeline.ages.map((_, index) => series.reduce((sum, item) => sum + item.values[index], 0));
        const canvas = el('canvas');
        const summary = `${fromAge}세 ${money(totals[0])}, ${toAge}세 ${money(totals[totals.length - 1])}`;
        section.append(
          el('ul', { class: 'chart-legend' },
            series.map((item) => el('li', {}, el('span', { class: 'swatch', style: `background: var(--${item.color})`, 'aria-hidden': 'true' }), item.name)),
            target ? el('li', {}, el('span', { class: 'legend-line', 'aria-hidden': 'true' }), '월 목표 생활비') : null,
            gapRange ? el('li', {}, el('span', { class: 'legend-gap', 'aria-hidden': 'true' }), '소득 공백기') : null),
          chartFrame(canvas, 260),
          el('details', { class: 'table-details' },
            el('summary', { text: '나이별 표로 보기' }),
            el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
              el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: '나이' }), series.map((item) => el('th', { scope: 'col', class: 'num', text: item.name })), el('th', { scope: 'col', class: 'num', text: '합계' }))),
              el('tbody', {}, timeline.ages.map((age, index) => el('tr', {},
                el('td', { text: `${age}세` }),
                series.map((item) => el('td', { class: 'num', text: money(item.values[index]) })),
                el('td', { class: 'num', text: money(totals[index]) }))))))),
          el('p', { class: 'assumption-note', text: `가정: 물가 연 ${pct(s.inflationRate)} · 종신 연금은 기대 수명 ${s.lifeExpectancy}세까지 · 세금 빼기로 한 연금은 연금마다 정한 세율을 뺀 추정치 · 적립형 연금은 각자 입력한 기준 수익률 · ${viewLabel}` }));
        pendingCharts.push((Chart) => renderIncomeChart(Chart, canvas, {
          labels: timeline.ages.map((age) => `${age}세`), series, target, gap: gapRange, money, label: `은퇴 후 월 소득: ${summary}`,
        }));
      }
      root.append(section);
    }

    // ── 연금별 요약 ──
    if (state.pensions.length > 0) {
      const cards = state.pensions.map((pension) => {
        const plan = plans.find((item) => item.id === pension.id);
        const head = el('div', { class: 'pension-card-head' },
          el('h3', { class: 'pension-name', text: pension.name }),
          el('span', { class: 'badge badge-tiny', text: PENSION_KIND_LABELS[pension.kind] }));
        if (!plan) {
          return el('li', { class: 'pension-card' }, head, el('p', { class: 'muted small', text: hasPerson ? '수령 개시 연령을 입력해 주세요.' : '설정에 출생연도를 넣으면 계산해요.' }));
        }
        const startText = plan.startMonth > nowMonth ? `앞으로 ${durationText(plan.startMonth - nowMonth)} 후` : '지금 받는 중';
        const amount = show(plan.startAmount.base, plan.startMonth);
        const details = [
          plan.lifetimeAssumed ? `종신 (기대 수명 ${s.lifeExpectancy}세까지로 계산)` : `${pension.payoutYears}년 동안`,
          pension.applyTax ? `연금소득세 ${pct(pension.taxRate)}를 뺀 추정치` : '세금 빼기 전 금액',
        ];
        if (pension.kind === 'fixed') {
          details.push(pension.inflationIndexed ? '받는 동안 물가만큼 올라요' : '받는 동안 금액이 그대로예요');
        } else {
          details.push(`받기 시작할 때 적립금 약 ${money(show(plan.balanceAtStart.base, plan.startMonth))}`);
          if (plan.startAmount.low !== plan.startAmount.high) {
            details.push(`월 수령액 낮음 ${money(show(plan.startAmount.low, plan.startMonth))} ~ 높음 ${money(show(plan.startAmount.high, plan.startMonth))}`);
          }
        }
        return el('li', { class: 'pension-card' },
          head,
          el('p', { class: 'pension-line', text: `${yearOf(plan.startMonth)}년(${ageAt(plan.startMonth, s.birthYear, s.birthMonth)}세)부터 수령 · ${startText} · 월 ${money(amount)}(${viewLabel})` }),
          el('p', { class: 'muted small', text: details.join(' · ') }),
          plan.warnings.map((warning) => el('p', { class: 'field-hint warn-text', text: warning })));
      });
      root.append(el('section', { class: 'card forecast-section', 'aria-label': '연금별 요약' },
        el('h2', { class: 'section-title', text: '연금별 요약' }),
        el('ul', { class: 'pension-cards' }, cards)));
    }

    // ── 공제회·예적금 ──
    if (state.otherAssets.length > 0) {
      const horizon = Math.max(nowMonth + 12, retirementMonth ?? nowMonth);
      const cards = state.otherAssets.map((asset) => {
        const projection = projectOtherAsset(asset, { nowMonth, endMonth: horizon });
        const lastMonth = projection.payoutMonth ?? horizon;
        const trimmed = (points) => points.filter((point) => point.month <= Math.max(lastMonth, projection.startMonth));
        const samples = Object.fromEntries(['low', 'base', 'high'].map((scenario) => [scenario, yearlySamples(trimmed(projection[scenario]))]));
        const labels = samples.base.map((point, index) => (index === 0 ? `${yearOf(point.month)}.${String((point.month % 12) + 1).padStart(2, '0')}` : String(yearOf(point.month))));
        const values = (scenario) => samples[scenario].map((point) => show(point.balance, point.month));
        const keyRows = [];
        const endMonth = projection.contributionEndMonth;
        if (asset.monthlyContribution > 0 && endMonth != null && endMonth > projection.startMonth && (projection.payoutMonth == null || endMonth < projection.payoutMonth)) {
          keyRows.push(['납입 종료', endMonth]);
        }
        keyRows.push([projection.payoutMonth != null ? '수령' : (retirementMonth != null ? '퇴직 시점' : '1년 뒤'), lastMonth]);
        const payoutPoint = valueAt(projection.base, lastMonth);
        // 시점은 열, 시나리오는 행: 휴대폰 폭에서도 금액 열이 2개뿐이라 넘치지 않는다
        const columns = keyRows.map(([title, month]) => ({
          title,
          month,
          values: Object.fromEntries(['low', 'base', 'high'].map((scenario) => [scenario, show(valueAt(projection[scenario], month).balance, month)])),
        }));
        // 이율을 하나만 넣었으면 세 시나리오가 같으므로 한 줄만
        const single = columns.every(({ values: v }) => v.low === v.base && v.base === v.high);
        const scenarioRows = single ? [['예상', 'base']] : [['낮음', 'low'], ['기준', 'base'], ['높음', 'high']];
        const keyTable = el('table', { class: 'table key-table' },
          el('thead', {}, el('tr', {},
            el('th', { scope: 'col' }, el('span', { class: 'visually-hidden', text: '시나리오' })),
            columns.map((column) => el('th', { scope: 'col', class: 'num' },
              el('div', { text: column.title }),
              el('div', { class: 'cell-sub', text: formatMonthIndex(column.month) }))))),
          el('tbody', {}, scenarioRows.map(([label, scenario]) => el('tr', { class: !single && scenario === 'base' ? 'is-base' : null },
            el('th', { scope: 'row', text: label }),
            columns.map((column) => el('td', { class: 'num', text: money(column.values[scenario]) }))))));
        const canvas = el('canvas');
        pendingCharts.push((Chart) => renderFanChart(Chart, canvas, {
          labels, low: values('low'), base: values('base'), high: values('high'), money,
          label: `${asset.name} 적립금: ${labels[labels.length - 1]}년 기준 ${money(values('base').at(-1))}`,
        }));
        return el('li', { class: 'deposit-card' },
          el('div', { class: 'pension-card-head' },
            el('h3', { class: 'pension-name', text: asset.name }),
            el('span', { class: 'badge badge-tiny', text: asset.type })),
          el('p', { class: 'muted small' }, el('span', { class: 'legend-fan', 'aria-hidden': 'true' }),
            `${single ? ' 예상 적립금' : ' 기준(진한 선)과 낮음~높음 범위(옅은 띠)'} · ${viewLabel}${asset.applyTax ? ' · 세후' : ''}`),
          chartFrame(canvas, 200),
          el('div', { class: 'table-wrap' }, keyTable),
          // 넣은 돈·이자·세금은 공제회·은행 앱과 비교할 수 있게 늘 실제 금액으로
          el('p', { class: 'small', text: `${single ? '' : '기준으로 보면 '}넣은 돈 ${money(payoutPoint.principal)} + 이자 ${money(payoutPoint.interest)}${payoutPoint.tax > 0 ? ` − 세금 ${money(payoutPoint.tax)}` : ''}${view === 'present' ? ' (실제 금액 기준)' : ''}` }),
          el('p', { class: 'assumption-note', text: `가정: 연 이율 ${rateRange(asset.interestRates)} · ${asset.compounding}${asset.contributionGrowthRate ? ` · 납입액 해마다 ${pct(asset.contributionGrowthRate)} 증액` : ''} · ${depositTaxNote(asset)}` }));
      });
      root.append(el('section', { class: 'card forecast-section', 'aria-label': '공제회·예적금' },
        el('h2', { class: 'section-title', text: '공제회·예적금 적립금' }),
        el('ul', { class: 'deposit-cards' }, cards)));
    }

    // ── 사용한 가정 ──
    const taxedItems = [...state.pensions, ...state.otherAssets].filter((item) => item.applyTax);
    root.append(el('section', { class: 'card assumptions-card', 'aria-label': '사용한 가정' },
      el('h2', { class: 'section-title', text: '사용한 가정' }),
      el('ul', { class: 'assumption-list' },
        el('li', { text: `물가상승률 연 ${pct(s.inflationRate)}` }),
        el('li', { text: `주식 기대 수익률 연 ${pct(s.stockReturnLow)} / ${pct(s.stockReturnBase)} / ${pct(s.stockReturnHigh)} (낮음 / 기준 / 높음), 매달 ${money(s.stockMonthlyInvestment)} 추가 투자` }),
        el('li', { text: `기대 수명 ${s.lifeExpectancy}세 (종신 연금을 받는 기간)` }),
        el('li', { text: taxedItems.length > 0 ? `세율: ${taxedItems.map((item) => `${item.name} ${pct(item.taxRate)}`).join(', ')} (세금 빼기를 켠 항목, 기타 자산에서 바꿀 수 있어요)` : '세금: 빼지 않았어요' }),
        el('li', { text: s.monthlyLivingCost ? `퇴직 후 월 목표 생활비 ${money(s.monthlyLivingCost)} (지금 돈 기준)` : '퇴직 후 월 목표 생활비: 입력 안 함' })),
      el('p', { class: 'muted small' }, '가정은 ', el('a', { href: '#settings', text: '설정' }), '에서 바꿀 수 있어요. 미래는 알 수 없으니 참고용으로만 봐 주세요.')));

    if (focusToggle) root.querySelector('.forecast-controls input:checked')?.focus();

    if (pendingCharts.length > 0) {
      loadChartLibrary()
        .then((Chart) => {
          if (current !== drawCount) return;
          charts = pendingCharts.map((make) => make(Chart));
        })
        .catch(() => {
          if (current !== drawCount) return;
          root.querySelectorAll('.chart-frame').forEach((frame) => frame.remove());
          root.prepend(el('p', { class: 'banner banner-info', text: '차트 도구를 불러오지 못해 표로만 보여드려요. 인터넷에 연결되면 다시 그려져요.' }));
        });
    }
  }

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
    destroyCharts();
  };
}
