// 기타 자산 탭: 공제회·예적금과 연금 목록 (추가·수정·삭제, 연금 순서 변경, 갱신 알림)

import { PENSION_KIND_LABELS, STALE_AFTER_DAYS } from '../constants.js';
import { valuePortfolio } from '../calc/valuation.js';
import { valueByAccount } from '../calc/totals.js';
import { formatMonthIndex, isOlderThan, monthIndexAtAge } from '../dates.js';
import { getMarket, subscribeMarket } from '../market.js';
import { el, clear, svg } from '../dom.js';
import { formatDate, formatMoney, formatNumber, formatYearMonth } from '../format.js';
import { openOtherAssetForm } from './other-asset-form.js';
import { openPensionForm, openPensionKindChooser } from './pension-form.js';
import { TOO_SMALL_MONTHLY } from '../pension.js';

const STALE_TITLE = '마지막으로 갱신한 지 1년이 넘었어요. 공제회·연금공단 등에서 확인한 최신 금액으로 바꿔 주세요.';

function staleBadge(item) {
  return isOlderThan(item.updatedAt, STALE_AFTER_DAYS)
    ? el('span', { class: 'badge badge-warn badge-tiny', title: STALE_TITLE, text: '업데이트할 때가 됐어요' })
    : null;
}

const pct = (value) => `${formatNumber(value, { maximumFractionDigits: 2 })}%`;

function rateText(rates) {
  return rates.low === rates.base && rates.base === rates.high
    ? `연 ${pct(rates.base)}`
    : `연 ${pct(rates.base)} (낮음 ${pct(rates.low)} ~ 높음 ${pct(rates.high)})`;
}

function arrowIcon(up) {
  return svg('svg', { class: 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, svg('path', { d: up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6' }));
}

// 보유 종목의 계좌별 원화 평가금액 (적립형 연금 계좌 연결용)
export function accountValuesOf(state) {
  const market = getMarket(state);
  return valueByAccount(valuePortfolio(state.holdings, { prices: market.prices, fxRate: market.fx.rate }).rows);
}

export function render(root, { getState, updateState, subscribe }) {
  function draw() {
    clear(root);
    const state = getState();
    const { settings } = state;
    const money = (value) => formatMoney(value, { unit: settings.displayUnit });
    const accountValues = accountValuesOf(state);

    if (!settings.birthYear) {
      root.append(el('p', { class: 'banner banner-info' },
        '연금을 받기 시작하는 때를 계산하려면 ', el('a', { href: '#settings', text: '설정' }), '에서 출생연도를 입력해 주세요.'));
    }

    // ── 공제회·예적금 ──
    const assetList = state.otherAssets.length === 0
      ? el('p', { class: 'muted', text: '아직 입력한 공제회·예적금이 없어요.' })
      : el('ul', { class: 'asset-list' }, state.otherAssets.map((asset) => {
        const plan = [
          asset.monthlyContribution > 0 ? `월 ${money(asset.monthlyContribution)} 납입 · ${formatYearMonth(asset.contributionEndDate)}까지` : '추가 납입 없음',
          asset.payoutDate ? `${formatYearMonth(asset.payoutDate)} 수령` : null,
        ].filter(Boolean).join(' · ');
        return el('li', {}, el('button', {
          type: 'button', class: 'asset-item', onClick: () => openOtherAssetForm({ asset, updateState }),
        },
        el('span', { class: 'asset-item-head' },
          el('span', { class: 'asset-name' }, el('span', { text: asset.name }), el('span', { class: 'badge badge-tiny', text: asset.type }), staleBadge(asset)),
          el('span', { class: 'asset-value num', text: money(asset.balance) })),
        el('span', { class: 'asset-meta', text: `${formatDate(asset.baseDate)} 기준${asset.accruedInterest > 0 ? ` · 원금 ${money(asset.balance - asset.accruedInterest)} + 이자 ${money(asset.accruedInterest)}` : ''}` }),
        el('span', { class: 'asset-meta', text: `${rateText(asset.interestRates)} · ${asset.compounding}${asset.applyTax ? ` · 세후 계산(세율 ${pct(asset.taxRate)})` : ''}` }),
        el('span', { class: 'asset-meta', text: plan })));
      }));

    root.append(el('section', { class: 'card asset-section' },
      el('div', { class: 'asset-section-head' },
        el('h2', { class: 'section-title', text: '공제회·예적금' }),
        el('button', { type: 'button', class: 'btn btn-small btn-primary', text: '+ 추가', onClick: () => openOtherAssetForm({ updateState }) })),
      assetList));

    // ── 연금 ──
    const move = (index, offset) => {
      updateState((draft) => {
        const [item] = draft.pensions.splice(index, 1);
        draft.pensions.splice(index + offset, 0, item);
      });
    };
    const openForm = (options) => openPensionForm({ getState, updateState, accountValues, ...options });

    const pensionList = state.pensions.length === 0
      ? el('p', { class: 'muted', text: '아직 입력한 연금이 없어요. 공무원연금·국민연금처럼 받을 금액을 조회할 수 있는 연금은 "확정 수령형", 연금저축·IRP는 "적립형"으로 추가하세요.' })
      : el('ul', { class: 'asset-list' }, state.pensions.map((pension, index) => {
        const start = settings.birthYear && pension.startAge != null
          ? `${formatMonthIndex(monthIndexAtAge(pension.startAge, settings.birthYear, settings.birthMonth))}(${pension.startAge}세)부터`
          : `${pension.startAge ?? '?'}세부터`;
        const term = pension.payoutType === '기간 지정' ? `${pension.payoutYears}년 동안` : '종신';
        let detail;
        let value;
        if (pension.kind === 'fixed') {
          value = `월 ${money(pension.expectedMonthlyAmount)}`;
          detail = `조회 금액 (${pension.amountBasis === 'future' ? '미래 금액' : '현재가치'} 기준)${pension.inflationIndexed ? ' · 물가연동' : ''}${pension.inquiryDate ? ` · ${formatDate(pension.inquiryDate)} 조회` : ''}`;
        } else if (pension.linkedAccount) {
          const linked = accountValues[pension.linkedAccount] ?? 0;
          value = money(linked);
          detail = linked > 0
            ? `${pension.linkedAccount} 계좌 보유 종목 금액을 써요 · ${rateText(pension.expectedReturns)}`
            : `${pension.linkedAccount} 계좌에 보유 종목이 없어요 — 보유 종목에서 추가해 주세요`;
        } else {
          value = money(pension.balance);
          detail = `${formatDate(pension.baseDate)} 기준 적립금 · ${rateText(pension.expectedReturns)}`;
        }
        const contribution = pension.kind === 'accumulating' && pension.monthlyContribution > 0
          ? ` · 월 ${money(pension.monthlyContribution)} 납입(${formatYearMonth(pension.contributionEndDate)}까지)`
          : '';
        // 예전에 만원 단위로 잘못 저장한 금액(150만원 → 150원)
        const tooSmall = pension.kind === 'fixed' && pension.expectedMonthlyAmount > 0 && pension.expectedMonthlyAmount < TOO_SMALL_MONTHLY;
        return el('li', { class: 'pension-row' },
          el('button', { type: 'button', class: 'asset-item', onClick: () => openForm({ pension }) },
            el('span', { class: 'asset-item-head' },
              el('span', { class: 'asset-name' },
                el('span', { text: pension.name }),
                el('span', { class: 'badge badge-tiny', text: PENSION_KIND_LABELS[pension.kind] }),
                staleBadge(pension)),
              el('span', { class: 'asset-value num', text: value })),
            el('span', { class: 'asset-meta', text: `${pension.category} · ${start} · ${term}${pension.applyTax ? ` · 세후 계산(세율 ${pct(pension.taxRate)})` : ''}` }),
            el('span', { class: 'asset-meta', text: `${detail}${contribution}` }),
            tooSmall
              ? el('span', { class: 'asset-meta warn-text', text: `월 ${pension.expectedMonthlyAmount}원으로 적혀 있어요. 눌러서 원 단위로 고쳐 주세요 (150만원 → 1500000).` })
              : null),
          el('span', { class: 'order-buttons' },
            el('button', { type: 'button', class: 'icon-btn', 'aria-label': `${pension.name} 위로`, disabled: index === 0, onClick: () => move(index, -1) }, arrowIcon(true)),
            el('button', { type: 'button', class: 'icon-btn', 'aria-label': `${pension.name} 아래로`, disabled: index === state.pensions.length - 1, onClick: () => move(index, 1) }, arrowIcon(false))));
      }));

    root.append(el('section', { class: 'card asset-section' },
      el('div', { class: 'asset-section-head' },
        el('h2', { class: 'section-title', text: '연금' }),
        el('button', { type: 'button', class: 'btn btn-small btn-primary', text: '+ 연금 추가', onClick: () => openPensionKindChooser((kind) => openForm({ kind })) })),
      pensionList));

    root.append(el('p', { class: 'muted small', text: '공제회·예적금과 연금은 사고팔 수 없어서 리밸런싱에는 넣지 않아요. 총자산과 분산 분석의 "전체" 보기, 미래 예측에 들어가요. 계좌에 연결한 적립형 연금은 보유 종목으로 이미 계산되므로 총자산에 다시 더하지 않아요.' }));
  }

  draw();
  const unsubscribeState = subscribe(draw);
  const unsubscribeMarket = subscribeMarket(draw);
  return () => {
    unsubscribeState();
    unsubscribeMarket();
  };
}
