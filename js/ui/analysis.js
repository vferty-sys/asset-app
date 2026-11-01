// 분산 분석 탭: 건강도 점수, 쏠림 경고, 국가·섹터·자산군·계좌 도넛 차트

import {
  ACCOUNTS, ASSET_CLASSES, COUNTRY_OPTIONS, DEPOSIT_ASSET_CLASS, NON_COUNTRY_NAMES, NON_SECTOR_NAMES, OTHER_ACCOUNT,
  PENSION_ASSET_CLASS, SECTOR_OPTIONS, UNCLASSIFIED,
} from '../constants.js';
import { valuePortfolio } from '../calc/valuation.js';
import { analyzeDiversification, concentrationAlerts, holdingWeights } from '../calc/diversification.js';
import { scorePortfolio } from '../calc/score.js';
import { otherFinancialAssets } from '../calc/totals.js';
import { cashInKRW } from '../cash.js';
import { buildChartData, loadChartLibrary, renderDoughnut } from '../charts.js';
import { COUNTRY_WEIGHTS, GLOBAL_COUNTRY, holdingCountryMix, presetMix, weightTableIssues } from '../country-weights.js';
import { getMarket, subscribeMarket } from '../market.js';
import { countryFixes, loadStockList } from '../stock-list.js';
import { el, clear, showToast } from '../dom.js';
import { formatMoney, formatPercent } from '../format.js';
import { segmented } from './form.js';
import { scoreCard } from './score-view.js';

const CHARTS = [
  { key: 'country', title: '국가별 비중', order: COUNTRY_OPTIONS, stocksOnly: true, limitKey: 'warnCountry', excluded: NON_COUNTRY_NAMES },
  { key: 'sector', title: '섹터별 비중', order: SECTOR_OPTIONS, stocksOnly: true, limitKey: 'warnSector', excluded: NON_SECTOR_NAMES },
  { key: 'assetClass', title: '자산군별 비중', order: [...ASSET_CLASSES, DEPOSIT_ASSET_CLASS, PENSION_ASSET_CLASS] },
  { key: 'account', title: '계좌별 비중', order: [...ACCOUNTS, OTHER_ACCOUNT] },
];

const ALERT_KINDS = { sector: '섹터', country: '국가', single: '한 종목' };

function alertsCard(alerts, settings) {
  const limits = `섹터 ${settings.warnSector}% · 국가 ${settings.warnCountry}% · 한 종목 ${settings.warnSingle}%`;
  const settingsNote = el('p', { class: 'muted small' }, `경고 기준(${limits})은 `, el('a', { href: '#settings', text: '설정' }), '에서 바꿀 수 있어요.');
  if (alerts.length === 0) {
    return el('section', { class: 'card alert-card' },
      el('h2', { class: 'section-title', text: '쏠림 경고' }),
      el('p', { class: 'alert-clear' }, el('span', { class: 'badge badge-ok', text: '양호' }), ' 기준을 넘는 쏠림이 없어요.'),
      settingsNote);
  }
  return el('section', { class: 'card alert-card' },
    el('h2', { class: 'section-title' }, '쏠림 경고 ', el('span', { class: 'badge badge-warn', text: `${alerts.length}건` })),
    el('ul', { class: 'alert-list' }, alerts.map((alert) => el('li', { class: 'alert-item' },
      el('span', { class: 'badge badge-warn', text: ALERT_KINDS[alert.kind] }),
      el('p', { text: alert.message })))),
    settingsNote);
}

// 국가 쏠림 계산 안내: 비중표에 없는 다국가 ETF(글로벌(다국가)), 비중표로 나눈 ETF, 합계가 1.0이 아닌 비중표 항목
function countryNotes(stocks, rows) {
  const notes = [];
  const issues = weightTableIssues();
  if (issues.length > 0) {
    notes.push(el('p', {
      class: 'banner banner-warn',
      text: `국가 비중표의 합계가 1.0이 아닌 항목이 있어요: ${issues.map(({ key, sum }) => `${key} ${sum}`).join(', ')}. js/country-weights.js의 비중을 확인해 주세요.`,
    }));
  }
  const global = stocks.country.find((item) => item.name === GLOBAL_COUNTRY);
  if (global) {
    const names = [...new Set(rows.filter((row) => row.valueKRW > 0 && holdingCountryMix(row.holding)[GLOBAL_COUNTRY] > 0).map((row) => row.holding.name))];
    notes.push(el('p', {
      class: 'banner banner-info',
      text: `국가별 분해 미반영: ${GLOBAL_COUNTRY} ${formatPercent(global.weight)} (${names.join(', ')}). 비중표에 없는 다국가 ETF라 나라별로 나누지 못했고, 국가 쏠림 경고에서는 뺐어요. `
        + '종목을 눌러 국가를 "비중표"나 "직접 나누기"(운용사 홈페이지의 나라별 비중)로 바꾸면 반영돼요.',
    }));
  }
  const presets = [...new Set(rows.filter((row) => row.valueKRW > 0 && presetMix(row.holding.countryPreset)).map((row) => row.holding.countryPreset))];
  if (presets.length > 0) {
    notes.push(el('p', {
      class: 'muted small',
      text: `다국가 ETF(${presets.join(', ')})는 국가 비중표(${COUNTRY_WEIGHTS.meta.updated_at} 기준, 대략값)대로 나라별로 나눠 더했어요.`,
    }));
  }
  return notes;
}

// 국가가 '한국'으로 저장됐지만 실제로는 다른 나라에 투자하는 ETF를 한 번에 고치는 카드
function countryFixCard(fixes, updateState) {
  const label = ({ countryMix, countryPreset }) => (countryPreset
    ? `비중표 ${countryPreset}`
    : Object.entries(countryMix).map(([name, percent]) => (percent === 100 ? name : `${name} ${percent}%`)).join(' · '));
  const button = el('button', { type: 'button', class: 'btn btn-primary', text: '투자 대상 나라로 고치기' });
  button.addEventListener('click', () => {
    const byId = new Map(fixes.map((fix) => [fix.holding.id, fix]));
    updateState((draft) => {
      for (const holding of draft.holdings) {
        const fix = byId.get(holding.id);
        if (!fix) continue;
        holding.countryMix = { ...fix.countryMix };
        holding.countryPreset = fix.countryPreset;
      }
    });
    showToast(`${fixes.length}개 종목의 국가를 고쳤어요`);
  });
  return el('section', { class: 'card alert-card country-fix' },
    el('h2', { class: 'section-title' }, '국가를 확인해 주세요 ', el('span', { class: 'badge badge-warn', text: `${fixes.length}개` })),
    el('p', { text: '국내에 상장된 ETF인데 국가가 "한국"으로 저장돼 있어요. 국가 쏠림은 ETF가 실제로 투자하는 나라로 계산해야 정확해요.' }),
    el('ul', { class: 'alert-list' }, fixes.map((fix) => el('li', { class: 'alert-item' },
      el('p', { text: `${fix.holding.name} (${fix.holding.account}): 한국 → ${label(fix)}` })))),
    el('div', { class: 'toolbar' }, button),
    el('p', { class: 'muted small', text: '고친 뒤에도 보유 종목에서 종목을 눌러 직접 바꿀 수 있어요.' }));
}

function chartCard(config, view, { settings, includeOthers, money }) {
  const { rows, slices } = buildChartData(view[config.key], { order: config.order });
  const limit = config.limitKey ? settings[config.limitKey] / 100 : null;
  let scope = config.stocksOnly || !includeOthers ? `주식 ${money(view.stockTotal)}` : `전체 ${money(view.total)}`;
  if (!config.stocksOnly && !includeOthers && view.cashTotal > 0) scope = `주식 + 예수금 ${money(view.stockTotal + view.cashTotal)}`;
  const canvas = el('canvas', { width: '200', height: '200' });
  const chartBox = el('div', { class: 'chart-box' }, canvas);

  const list = el('ul', { class: 'breakdown' }, rows.map((row) => {
    const over = limit != null && !config.excluded.includes(row.name) && row.weight > limit;
    return el('li', { class: 'breakdown-row' },
      el('span', { class: 'swatch', style: `background: var(--${row.color})`, 'aria-hidden': 'true' }),
      el('span', { class: 'breakdown-name' }, el('span', { text: row.name }), over ? el('span', { class: 'badge badge-warn badge-tiny', text: '기준 초과' }) : null),
      el('span', { class: 'breakdown-weight num', text: formatPercent(row.weight) }),
      el('span', { class: 'breakdown-value num', text: money(row.value) }));
  }));

  const summary = rows.map((row) => `${row.name} ${formatPercent(row.weight)}`).join(', ');
  const grayRows = rows.filter((row) => row.color === 'series-other');
  const grouped = grayRows.length > 1
    ? el('p', { class: 'muted small', text: `회색 항목 ${grayRows.length}개는 차트에서 한 조각(${slices.find((slice) => slice.color === 'series-other').name})으로 묶었어요.` })
    : null;
  return {
    slices,
    canvas,
    label: `${config.title}: ${summary}`,
    removeChart: () => chartBox.remove(),
    element: el('section', { class: 'card chart-card' },
      el('div', { class: 'chart-card-head' },
        el('h2', { class: 'section-title', text: config.title }),
        el('span', { class: 'muted small', text: scope })),
      chartBox,
      list,
      grouped),
  };
}

export function render(root, { getState, updateState, subscribe }) {
  let includeOthers = false;
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
    const money = (value) => formatMoney(value, { unit: state.settings.displayUnit });
    const market = getMarket(state);
    const portfolio = valuePortfolio(state.holdings, { prices: market.prices, fxRate: market.fx.rate });
    // 예수금은 자산군(현금성)·계좌 차트에만 더한다 (국가·섹터·쏠림·점수에는 넣지 않음)
    const cash = cashInKRW(state.cash, market.fx.rate);
    const stocks = analyzeDiversification(portfolio.rows, { cashByAccount: cash.byAccount });

    if (stocks.stockTotal <= 0) {
      const noValue = state.holdings.length > 0;
      root.append(el('section', { class: 'card empty-state' },
        el('p', { class: 'empty-title', text: noValue ? '평가금액을 계산할 수 있는 종목이 없어요' : '분석할 종목이 없어요' }),
        el('p', { class: 'muted', text: noValue ? '보유 종목의 현재가나 달러 환율을 확인해 주세요.' : '보유 종목을 입력하면 국가·섹터·자산군별로 얼마나 나뉘어 있는지 분석해 드려요.' }),
        el('a', { class: 'btn btn-primary', href: '#holdings', text: '보유 종목으로 가기' })));
      return;
    }

    const score = scorePortfolio(portfolio.rows, state.settings);
    const alerts = concentrationAlerts({ ...stocks, holdings: holdingWeights(portfolio.rows) }, state.settings);
    const view = includeOthers
      ? analyzeDiversification(portfolio.rows, { includeOthers: true, otherAssets: state.otherAssets, pensions: state.pensions, cashByAccount: cash.byAccount })
      : stocks;

    // 국가를 고칠 ETF는 종목 목록을 받아 온 뒤에 찾아서 쏠림 경고 바로 아래에 보여준다
    const fixSlot = el('div', { class: 'country-fix-slot' });
    root.append(scoreCard(score), alertsCard(alerts, state.settings), fixSlot);
    loadStockList()
      .catch(() => [])
      .then((items) => {
        if (current !== drawCount) return;
        const fixes = countryFixes(state.holdings, items);
        if (fixes.length > 0) fixSlot.append(countryFixCard(fixes, updateState));
      });
    if (portfolio.missingFxCount > 0) {
      root.append(el('p', { class: 'banner banner-warn' },
        `달러 환율이 없어서 달러 종목 ${portfolio.missingFxCount}개는 분석에서 빠졌어요. `,
        el('a', { href: '#settings', text: '설정에서 환율 입력하기' })));
    }

    // 차트 보기 전환 (아래 차트에만 적용)
    const toggle = segmented({
      options: [['stocks', '주식만'], ['all', '기타 금융자산 포함 전체']],
      value: includeOthers ? 'all' : 'stocks',
      onChange: (value) => {
        includeOthers = value === 'all';
        draw({ focusToggle: true });
      },
    });
    toggle.element.setAttribute('aria-label', '차트에 넣을 자산');
    const notes = [];
    if (cash.total > 0) notes.push(`예수금 ${money(cash.total)}은 자산군(현금성)·계좌 차트에 더했어요. 국가·섹터와 쏠림 경고에는 넣지 않아요.`);
    if (includeOthers) {
      notes.push('국가·섹터는 주식만 집계해요. 공제회·예적금·연금은 나라·업종을 나누기 어려워 자산군·계좌 차트에만 더했어요.');
      if (otherFinancialAssets(state).total <= 0) notes.push('아직 입력한 공제회·예적금·연금이 없어요. 기타 자산 탭에서 입력하면 함께 볼 수 있어요.');
    }
    root.append(el('div', { class: 'view-toggle' }, toggle.element, notes.map((note) => el('p', { class: 'muted small', text: note }))));

    const cards = CHARTS.map((config) => chartCard(config, view, { settings: state.settings, includeOthers, money }));
    const fallback = el('p', { class: 'banner banner-info', hidden: true, text: '차트 도구를 불러오지 못해 목록으로만 보여드려요. 인터넷에 연결되면 다시 그려져요.' });
    root.append(...countryNotes(stocks, portfolio.rows), fallback, el('div', { class: 'chart-grid' }, cards.map((card) => card.element)));
    if (stocks.country.some((item) => item.name === UNCLASSIFIED) || stocks.sector.some((item) => item.name === UNCLASSIFIED)) {
      root.append(el('p', { class: 'muted small', text: '미분류는 국가·섹터 비율 합계가 100%가 안 되는 종목의 나머지예요. 보유 종목에서 비율을 채우면 사라져요.' }));
    }
    if (focusToggle) root.querySelector('.view-toggle input:checked')?.focus();

    loadChartLibrary()
      .then((Chart) => {
        if (current !== drawCount) return;
        for (const card of cards) {
          if (card.slices.length === 0) card.removeChart();
          else charts.push(renderDoughnut(Chart, card.canvas, { slices: card.slices, money, label: card.label }));
        }
      })
      .catch(() => {
        if (current !== drawCount) return;
        cards.forEach((card) => card.removeChart());
        fallback.hidden = false;
      });
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
    destroyCharts();
  };
}
