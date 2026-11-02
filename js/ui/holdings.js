// 보유 종목 탭: 요약, 경고, 종목 히트맵(칸 크기 = 평가금액, 색 = 수익률) 또는 목록(PC는 표, 모바일은 카드)

import { BROAD_ASSET_CLASSES, ETF_SPREAD_LABELS, STORAGE_PREFIX } from '../constants.js';
import { valuePortfolio } from '../calc/valuation.js';
import { holdingCountryMix } from '../country-weights.js';
import { isMixComplete } from '../holding.js';
import { findPriceIssues } from '../price.js';
import { getMarket, getPendingTickers, subscribeMarket } from '../market.js';
import { el, clear, copyText, helpTip, openModal, showToast } from '../dom.js';
import { formatMoney, formatNumber, formatPercent, formatPrice, formatQuoteTime, pnlClass, EMPTY } from '../format.js';
import { openHoldingForm } from './holding-form.js';
import { openCsvImport } from './holdings-csv.js';
import { cashCard } from './cash-form.js';
import { segmented } from './form.js';
import { holdingsHeatmap } from './heatmap.js';

// 종목을 히트맵으로 볼지 목록으로 볼지, 히트맵을 무엇으로 묶을지 (이 기기에만 기억)
const VIEW_KEY = `${STORAGE_PREFIX}holdingsView`;
const GROUP_KEY = `${STORAGE_PREFIX}heatmapGroup`;
const VIEW_OPTIONS = [['heatmap', '히트맵'], ['list', '목록']];
const GROUP_VALUES = ['assetClass', 'account', 'none'];

function readPref(key, allowed) {
  try {
    const value = globalThis.localStorage?.getItem(key);
    return allowed.includes(value) ? value : allowed[0];
  } catch {
    return allowed[0];
  }
}

function savePref(key, value) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // 저장할 수 없으면 이번에만 바꾼다
  }
}

const HELP = {
  pnl: [
    '지금 모두 판다면 생기는 이익이나 손실이에요. (세금·수수료 제외)',
    '달러 종목은 산 가격과 지금 가격 모두 현재 환율로 바꿔 계산해요. 환율이 올라 생긴 이익은 빠져 있어요.',
  ],
  dividend: '종목마다 입력한 "연간 주당 배당금 × 수량"을 더한 값이에요. 실제 배당금은 회사 사정에 따라 달라질 수 있어요.',
};

function quantityText(holding) {
  return `${formatNumber(holding.quantity, { maximumFractionDigits: 4 })}주`;
}

// 'ETF(시장 전체형)'. 채권·현금성 ETF는 분산 정도를 고르지 않으므로 'ETF'만
function etfLabel(holding) {
  if (holding.type !== 'etf') return null;
  return BROAD_ASSET_CLASSES.includes(holding.assetClass) || !holding.etfSpread ? 'ETF' : `ETF(${ETF_SPREAD_LABELS[holding.etfSpread]})`;
}

function subline(holding) {
  return [holding.ticker, holding.account, etfLabel(holding)].filter(Boolean).join(' · ');
}

function badge(tone, text, title) {
  return el('span', { class: `badge badge-tiny${tone ? ` badge-${tone}` : ''}`, title, text });
}

// 현재가를 어디서 가져왔는지 표시한다. 시트 가격이면 표시하지 않는다.
function priceBadge(row, mode) {
  if (row.currencyMismatch) return badge('danger', '통화 확인', '시트의 통화와 종목 통화가 달라 시트 가격을 쓰지 않았어요');
  if (row.priceSource === 'manual' && mode === 'sheet') return badge('', '직접 입력', '시트에서 가격을 받지 못해 직접 입력한 현재가를 썼어요');
  if (row.priceSource === 'avg') return badge('warn', '평단가', '현재가가 없어 평단가로 계산했어요');
  if (row.priceSource === 'none') return badge('danger', '가격 없음');
  return null;
}

// 'A, B, C 외 2개'
function tickerList(tickers, limit = 3) {
  const shown = tickers.slice(0, limit).join(', ');
  return tickers.length > limit ? `${shown} 외 ${tickers.length - limit}개` : shown;
}

function byValueDesc(a, b) {
  const av = a.valueKRW ?? -Infinity;
  const bv = b.valueKRW ?? -Infinity;
  return bv - av || a.holding.name.localeCompare(b.holding.name, 'ko');
}

// 히트맵 칸을 누르면: 그 종목의 금액·손익과 계좌별 보유 내역, 계좌마다 수정 버튼
function openHeatDetail(item, { money, mode, openForm }) {
  const [first] = item.rows;
  const pnlText = item.pnl == null
    ? EMPTY
    : `${money(item.pnl, { signed: true })} (${formatPercent(item.returnRate, { signed: true })})`;
  const facts = [
    ['평가금액', money(item.value), null],
    ['비중', formatPercent(item.weight), null],
    ['평가손익', pnlText, pnlClass(item.pnl)],
    ['현재가', formatPrice(first.price, first.holding.currency), null],
  ];
  let close = () => {};
  const body = el('div', { class: 'heat-detail' },
    el('p', { class: 'muted small' }, [item.ticker, etfLabel(first.holding)].filter(Boolean).join(' · '), ' ', priceBadge(first, mode)),
    el('dl', { class: 'cost-list' }, facts.map(([label, value, tone]) => el('div', { class: 'cost-row' },
      el('dt', { text: label }),
      el('dd', { class: `num ${tone ?? ''}`.trim(), text: value })))),
    el('p', { class: 'field-label', text: item.rows.length > 1 ? `계좌별 (${item.rows.length}개 계좌)` : '계좌' }),
    el('ul', { class: 'heat-accounts' }, item.rows.map((row) => el('li', { class: 'heat-account' },
      el('div', {},
        el('p', { class: 'cell-name', text: row.holding.account }),
        el('p', { class: 'cell-sub num', text: `${quantityText(row.holding)} · 평단가 ${formatPrice(row.holding.avgPrice, row.holding.currency)} · 평가 ${row.valueKRW == null ? EMPTY : money(row.valueKRW)}` })),
      el('button', {
        type: 'button', class: 'btn btn-small', text: '수정', 'aria-label': `${row.holding.account} 계좌 ${row.holding.name} 수정`,
        onClick: () => {
          close();
          openForm(row.holding);
        },
      })))));
  const closeButton = el('button', { type: 'button', class: 'btn', text: '닫기' });
  ({ close } = openModal({ title: item.name, body, footer: [el('span', { class: 'spacer' }), closeButton] }));
  closeButton.addEventListener('click', () => close());
}

function stat({ label, help, value, valueClass = '', sub, subClass = '', main = false }) {
  return el('div', { class: `stat${main ? ' stat-main' : ''}` },
    el('p', { class: 'stat-label' }, label, help ? helpTip(label, help) : null),
    el('p', { class: `stat-value num ${valueClass}`, text: value }),
    sub ? el('p', { class: `stat-sub num ${subClass}`, text: sub }) : null);
}

export function render(root, { getState, updateState, subscribe }) {
  const openForm = (holding) => openHoldingForm({ holding, getState, updateState });
  let view = readPref(VIEW_KEY, ['heatmap', 'list']);
  let groupBy = readPref(GROUP_KEY, GROUP_VALUES);

  function toolbar(withView = false) {
    const viewControl = withView
      ? segmented({
        options: VIEW_OPTIONS,
        value: view,
        onChange: (next) => {
          view = next;
          savePref(VIEW_KEY, next);
          draw();
          root.querySelector('.view-toggle input:checked')?.focus();
        },
      })
      : null;
    viewControl?.element.classList.add('view-toggle');
    viewControl?.element.setAttribute('aria-label', '종목 보기 방식');
    return el('div', { class: 'toolbar holdings-toolbar' },
      el('button', { type: 'button', class: 'btn btn-primary', text: '+ 종목 추가', onClick: () => openForm(null) }),
      el('button', { type: 'button', class: 'btn', text: 'CSV 붙여넣기', onClick: () => openCsvImport({ getState, updateState }) }),
      viewControl ? el('span', { class: 'spacer' }) : null,
      viewControl?.element);
  }

  function draw() {
    clear(root);
    const state = getState();
    const money = (value, options) => formatMoney(value, { unit: state.settings.displayUnit, ...options });
    const market = getMarket(state);
    const cash = () => cashCard({ state, money, fxRate: market.fx.rate, getState, updateState });
    if (state.holdings.length === 0) {
      root.append(el('section', { class: 'card empty-state' },
        el('p', { class: 'empty-title', text: '아직 등록한 종목이 없어요' }),
        el('p', { class: 'muted', text: '가지고 있는 주식·ETF를 하나씩 추가하거나, 엑셀·구글 시트의 표를 붙여넣어 한 번에 등록하세요.' }),
        toolbar()), cash());
      return;
    }

    const portfolio = valuePortfolio(state.holdings, { prices: market.prices, fxRate: market.fx.rate });
    const issues = findPriceIssues(state.holdings, market);
    const rows = [...portfolio.rows].sort(byValueDesc);
    const pnlText = (row) => (row.pnlKRW == null
      ? EMPTY
      : `${money(row.pnlKRW, { signed: true })} (${formatPercent(row.returnRate, { signed: true })})`);
    const valueText = (row) => (row.valueKRW == null ? '환율 필요' : money(row.valueKRW));

    root.append(el('section', { class: 'card summary-card', 'aria-label': '보유 종목 요약' },
      stat({ label: '총 평가금액', value: money(portfolio.totalValue), sub: `${state.holdings.length}개 종목`, main: true }),
      stat({
        label: '평가손익',
        help: HELP.pnl,
        value: money(portfolio.totalPnl, { signed: true }),
        valueClass: pnlClass(portfolio.totalPnl),
        sub: formatPercent(portfolio.totalReturn, { signed: true }),
        subClass: pnlClass(portfolio.totalPnl),
      }),
      stat({
        label: '예상 연 배당금',
        help: HELP.dividend,
        value: money(portfolio.annualDividend),
        sub: portfolio.annualDividend > 0 ? `월 평균 약 ${money(portfolio.annualDividend / 12)}` : '주당 배당금을 입력하면 계산해요',
      }),
      market.mode === 'sheet'
        ? el('p', {
          class: 'summary-note',
          text: market.updatedAt ? `시세 기준: ${formatQuoteTime(market.updatedAt)} (약 20분 지연)` : '시트에서 시세를 아직 받지 못했어요.',
        })
        : el('p', { class: 'summary-note' },
          '구글 시트를 연결하지 않아 직접 입력한 현재가로 계산해요. ',
          el('a', { href: '#guide', text: '시트 연결 방법' }))));

    // 시트에 새로 넣고 가격을 기다리는 종목은 오류가 아니라 '받는 중'으로 따로 알린다
    const pending = new Set(getPendingTickers());
    const waitingTickers = issues.sheetErrors.filter((ticker) => pending.has(ticker));
    issues.sheetErrors = issues.sheetErrors.filter((ticker) => !pending.has(ticker));
    if (waitingTickers.length > 0) {
      root.append(el('p', {
        class: 'banner banner-info',
        role: 'status',
        text: `시트에 새로 넣은 종목 ${waitingTickers.length}개(${tickerList(waitingTickers)})의 가격을 받는 중이에요. 몇 초 뒤에 들어와요.`,
      }));
    }

    // 확인할 것들을 한 상자에 모아 보여준다.
    const notices = [];
    const warn = (...content) => notices.push(el('li', {}, ...content));
    if (issues.notInSheet.length > 0) {
      const count = issues.notInSheet.length;
      if (market.canAddTickers) {
        // 최신 시트 코드: 앱이 시세를 받을 때 이 티커를 시트에 넣는다 (종목을 추가하면 잠시 뒤 알아서)
        warn(`시트에 아직 없는 종목 ${count}개 (${tickerList(issues.notInSheet)}) — 앱이 시트에 넣고 가격을 받아와요. `
          + '이 안내가 계속 보이면 위쪽 시세 시각을 눌러 다시 받아 보세요.');
      } else {
        const copy = el('button', { type: 'button', class: 'btn btn-small', text: '티커 복사' });
        copy.addEventListener('click', async () => {
          const copied = await copyText(issues.notInSheet.join('\n'));
          showToast(copied ? '티커를 복사했어요. 시트 A열 빈 칸에 붙여넣으세요.' : '복사하지 못했어요. 티커를 직접 적어 주세요.', copied ? 'info' : 'danger', 3500);
        });
        warn(`시트에 없는 종목 ${count}개 (${tickerList(issues.notInSheet)}) — 가격 없음. `,
          el('a', { href: '#guide', text: '시트 코드를 최신으로 바꾸면' }),
          ' 앱이 알아서 넣어 줘요. 지금 바로 하려면 티커를 복사해 시트 A열에 붙여넣으세요. ', copy);
      }
    }
    if (issues.sheetErrors.length > 0) {
      warn(`시트에서 가격을 받지 못한 종목 ${issues.sheetErrors.length}개 (${tickerList(issues.sheetErrors)}) — 시트에 #N/A가 보이면 티커 형식(예: KRX:005930)을 확인해 주세요.`);
    }
    if (issues.currencyMismatch.length > 0) {
      warn(`시트의 통화와 종목 통화가 다른 종목 (${tickerList(issues.currencyMismatch)}) — 종목을 눌러 통화를 확인해 주세요. 그동안 시트 가격은 쓰지 않아요.`);
    }
    if (portfolio.missingFxCount > 0) {
      warn(`달러 환율이 없어서 달러 종목 ${portfolio.missingFxCount}개는 합계에서 뺐어요. `,
        market.mode === 'sheet' ? '시트의 CURRENCY:USDKRW 줄에 환율 숫자가 나오는지(#N/A가 아닌지) 확인하거나 ' : '',
        el('a', { href: '#settings', text: '설정에서 환율 입력하기' }));
    }
    // 평단가로 계산한 종목이 모두 가격을 기다리는 종목이면 위 '받는 중' 안내로 충분하다
    const avgOnlyWaiting = portfolio.rows.filter((row) => row.priceSource === 'avg').every((row) => pending.has(row.holding.ticker));
    if (portfolio.avgPriceCount > 0 && !avgOnlyWaiting) {
      warn(market.mode === 'sheet'
        ? `현재가를 받지 못한 종목 ${portfolio.avgPriceCount}개는 평단가로 계산했어요.`
        : `현재가가 없는 종목 ${portfolio.avgPriceCount}개는 평단가로 계산했어요. 종목을 눌러 현재가를 입력하거나 구글 시트를 연결해 주세요.`);
    }
    const incompleteMix = state.holdings.filter((h) => !isMixComplete(holdingCountryMix(h)) || !isMixComplete(h.sectorMix)).length;
    if (incompleteMix > 0) {
      warn(`국가·섹터 비율 합계가 100%가 아닌 종목이 ${incompleteMix}개 있어요. 분산 분석이 정확하지 않을 수 있어요.`);
    }
    if (notices.length > 0) {
      root.append(el('section', { class: 'banner banner-warn notice-box', 'aria-label': '확인해 주세요' },
        el('p', { class: 'notice-title', text: '확인해 주세요' }),
        el('ul', { class: 'notice-list' }, notices)));
    }

    // ── 히트맵 보기 ──
    if (view === 'heatmap') {
      const heatmap = holdingsHeatmap({
        rows: portfolio.rows,
        money,
        groupBy,
        invertColors: state.settings.invertPnlColors,
        onGroupChange: (next) => {
          groupBy = next;
          savePref(GROUP_KEY, next);
          draw();
          root.querySelector('.heat-groupby input:checked')?.focus();
        },
        onSelect: (item) => openHeatDetail(item, { money, mode: market.mode, openForm }),
      });
      // 평가금액이 0이거나 모르는 종목(새로 살 종목·가격 없음·환율 없음)은 칸이 없으니 아래에 따로
      const outside = rows.filter((row) => !(row.valueKRW > 0));
      const outsideReason = (row) => {
        if (row.valueKRW == null) return '환율 필요';
        if (row.holding.quantity === 0) return '수량 0';
        return '가격 없음';
      };
      root.append(el('section', { class: 'holdings-section', 'aria-label': '종목 히트맵' },
        toolbar(true),
        heatmap ?? el('p', { class: 'card muted', text: '평가금액이 있는 종목이 없어서 히트맵을 그릴 수 없어요.' }),
        el('div', { class: 'heat-after' },
          outside.length > 0
            ? el('div', { class: 'heat-outside' },
              el('p', { class: 'muted small', text: '히트맵에 없는 종목 (평가금액 0 또는 모름)' }),
              el('ul', { class: 'heat-chips' }, outside.map((row) => el('li', {}, el('button', {
                type: 'button', class: 'btn btn-small', onClick: () => openForm(row.holding),
              }, `${row.holding.name} · ${outsideReason(row)}`)))))
            : null,
          el('p', { class: 'muted small', text: '칸을 누르면 계좌별 보유 내역을 보고 고칠 수 있어요. 자세한 표는 "목록"에서 볼 수 있어요.' }))), cash());
      return;
    }

    const table = el('table', { class: 'table holdings-table' },
      el('thead', {}, el('tr', {},
        ['종목', '수량', '평단가', '현재가', '평가금액', '손익', '비중']
          .map((title, index) => el('th', { scope: 'col', class: index > 0 ? 'num' : null, text: title })),
        el('th', { scope: 'col' }, el('span', { class: 'visually-hidden', text: '수정' })))),
      el('tbody', {}, rows.map((row) => {
        const { holding } = row;
        return el('tr', {},
          el('td', {}, el('div', { class: 'cell-name', text: holding.name }), el('div', { class: 'cell-sub', text: subline(holding) })),
          el('td', { class: 'num', text: quantityText(holding) }),
          el('td', { class: 'num', text: formatPrice(holding.avgPrice, holding.currency) }),
          el('td', { class: 'num' }, el('div', { text: formatPrice(row.price, holding.currency) }), priceBadge(row, market.mode)),
          el('td', { class: 'num', text: valueText(row) }),
          el('td', { class: `num ${pnlClass(row.pnlKRW)}` },
            el('div', { text: row.pnlKRW == null ? EMPTY : money(row.pnlKRW, { signed: true }) }),
            el('div', { class: 'cell-sub', text: formatPercent(row.returnRate, { signed: true }) })),
          el('td', { class: 'num', text: formatPercent(row.weight) }),
          el('td', { class: 'cell-action' },
            el('button', { type: 'button', class: 'btn btn-small', 'aria-label': `${holding.name} 수정`, text: '수정', onClick: () => openForm(holding) })));
      })));

    const cards = el('ul', { class: 'holding-cards' }, rows.map((row) => {
      const { holding } = row;
      return el('li', {}, el('button', { type: 'button', class: 'holding-card', onClick: () => openForm(holding) },
        el('span', { class: 'hc-row' },
          el('span', { class: 'hc-name', text: holding.name }),
          el('span', { class: 'hc-value num', text: valueText(row) })),
        el('span', { class: 'hc-row' },
          el('span', { class: 'hc-meta', text: subline(holding) }),
          el('span', { class: `hc-pnl num ${pnlClass(row.pnlKRW)}`, text: pnlText(row) })),
        el('span', { class: 'hc-row' },
          el('span', { class: 'hc-meta' }, `${quantityText(holding)} · 현재가 ${formatPrice(row.price, holding.currency)} `, priceBadge(row, market.mode)),
          el('span', { class: 'hc-meta num', text: `비중 ${formatPercent(row.weight)}` }))));
    }));

    root.append(el('section', { class: 'holdings-section', 'aria-label': '종목 목록' },
      toolbar(true),
      el('div', { class: 'card table-card holdings-table-wrap' }, el('div', { class: 'table-wrap' }, table)),
      cards), cash());
  }

  draw();
  const unsubscribeState = subscribe(draw);
  const unsubscribeMarket = subscribeMarket(draw);
  return () => {
    unsubscribeState();
    unsubscribeMarket();
  };
}
