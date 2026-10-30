// 보유 종목 탭: 요약, 경고, 종목 목록(PC는 표, 모바일은 카드)

import { valuePortfolio } from '../calc/valuation.js';
import { isMixComplete } from '../holding.js';
import { getMarket } from '../market.js';
import { el, clear, helpTip } from '../dom.js';
import { formatMoney, formatNumber, formatPercent, formatPrice, pnlClass, EMPTY } from '../format.js';
import { openHoldingForm } from './holding-form.js';
import { openCsvImport } from './holdings-csv.js';

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

function subline(holding) {
  return [holding.ticker, holding.account, holding.type === 'etf' ? 'ETF' : null].filter(Boolean).join(' · ');
}

function priceBadge(row) {
  if (row.priceSource === 'avg') return el('span', { class: 'badge badge-warn badge-tiny', title: '현재가가 없어 평단가로 계산했어요', text: '평단가' });
  if (row.priceSource === 'none') return el('span', { class: 'badge badge-danger badge-tiny', text: '가격 없음' });
  return null;
}

function byValueDesc(a, b) {
  const av = a.valueKRW ?? -Infinity;
  const bv = b.valueKRW ?? -Infinity;
  return bv - av || a.holding.name.localeCompare(b.holding.name, 'ko');
}

function stat({ label, help, value, valueClass = '', sub, subClass = '', main = false }) {
  return el('div', { class: `stat${main ? ' stat-main' : ''}` },
    el('p', { class: 'stat-label' }, label, help ? helpTip(label, help) : null),
    el('p', { class: `stat-value num ${valueClass}`, text: value }),
    sub ? el('p', { class: `stat-sub num ${subClass}`, text: sub }) : null);
}

export function render(root, { getState, updateState, subscribe }) {
  const openForm = (holding) => openHoldingForm({ holding, getState, updateState });

  function toolbar() {
    return el('div', { class: 'toolbar' },
      el('button', { type: 'button', class: 'btn btn-primary', text: '+ 종목 추가', onClick: () => openForm(null) }),
      el('button', { type: 'button', class: 'btn', text: 'CSV 붙여넣기', onClick: () => openCsvImport({ getState, updateState }) }));
  }

  function draw() {
    clear(root);
    const state = getState();
    if (state.holdings.length === 0) {
      root.append(el('section', { class: 'card empty-state' },
        el('p', { class: 'empty-title', text: '아직 등록한 종목이 없어요' }),
        el('p', { class: 'muted', text: '가지고 있는 주식·ETF를 하나씩 추가하거나, 엑셀·구글 시트의 표를 붙여넣어 한 번에 등록하세요.' }),
        toolbar()));
      return;
    }

    const money = (value, options) => formatMoney(value, { unit: state.settings.displayUnit, ...options });
    const market = getMarket(state);
    const portfolio = valuePortfolio(state.holdings, { prices: market.prices, fxRate: market.fx.rate });
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
      })));

    if (portfolio.missingFxCount > 0) {
      root.append(el('div', { class: 'banner banner-warn' },
        `달러 환율이 없어서 달러 종목 ${portfolio.missingFxCount}개는 합계에서 뺐어요. `,
        el('a', { href: '#settings', text: '설정에서 환율 입력하기' })));
    }
    if (portfolio.avgPriceCount > 0) {
      root.append(el('div', {
        class: 'banner banner-warn',
        text: `현재가가 없는 종목 ${portfolio.avgPriceCount}개는 평단가로 계산했어요. 종목을 눌러 현재가를 입력해 주세요.`,
      }));
    }
    const incompleteMix = state.holdings.filter((h) => !isMixComplete(h.countryMix) || !isMixComplete(h.sectorMix)).length;
    if (incompleteMix > 0) {
      root.append(el('div', {
        class: 'banner banner-warn',
        text: `국가·섹터 비율 합계가 100%가 아닌 종목이 ${incompleteMix}개 있어요. 분산 분석이 정확하지 않을 수 있어요.`,
      }));
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
          el('td', { class: 'num' }, el('div', { text: formatPrice(row.price, holding.currency) }), priceBadge(row)),
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
          el('span', { class: 'hc-meta' }, `${quantityText(holding)} · 현재가 ${formatPrice(row.price, holding.currency)} `, priceBadge(row)),
          el('span', { class: 'hc-meta num', text: `비중 ${formatPercent(row.weight)}` }))));
    }));

    root.append(el('section', { class: 'holdings-section', 'aria-label': '종목 목록' },
      toolbar(),
      el('div', { class: 'card table-card holdings-table-wrap' }, el('div', { class: 'table-wrap' }, table)),
      cards));
  }

  draw();
  return subscribe(draw);
}
