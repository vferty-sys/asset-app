// 기타 자산 탭: 공제회·예적금, 연금, 부동산, 대출 목록 (추가·수정·삭제, 연금 순서 변경, 갱신 알림)
// 공제회·예적금과 대출은 기준일 금액에서 계획(납입·이자, 상환)대로 계산한 오늘 금액을 보여 준다.

import { LOAN_METHOD_LABELS, PENSION_KIND_LABELS, STALE_AFTER_DAYS } from '../constants.js';
import { valuePortfolio } from '../calc/valuation.js';
import { valueByAccount } from '../calc/totals.js';
import { estimateOtherAssetNow } from '../calc/projection.js';
import { loansSummary } from '../calc/loan.js';
import { cashInKRW } from '../cash.js';
import { currentMonthIndex, durationText, formatMonthIndex, isOlderThan, monthIndexAtAge, parseMonth, todayString } from '../dates.js';
import { getMarket, subscribeMarket } from '../market.js';
import { el, clear, svg } from '../dom.js';
import { formatDate, formatMoney, formatNumber, formatYearMonth } from '../format.js';
import { openOtherAssetForm } from './other-asset-form.js';
import { openPensionForm, openPensionKindChooser } from './pension-form.js';
import { openLoanForm } from './loan-form.js';
import { openRealEstateForm } from './real-estate-form.js';
import { TOO_SMALL_MONTHLY } from '../pension.js';
import { realEstateTotal, realEstateValue } from '../real-estate.js';
import { aptLabel, autoAreaText } from '../apt-price.js';

const STALE_TITLE = '마지막으로 갱신한 지 1년이 넘었어요. 공제회·연금공단 등에서 확인한 최신 금액으로 바꿔 주세요.';

function staleBadge(item) {
  return isOlderThan(item.updatedAt, STALE_AFTER_DAYS)
    ? el('span', { class: 'badge badge-warn badge-tiny', title: STALE_TITLE, text: '업데이트할 때가 됐어요' })
    : null;
}

const pct = (value) => `${formatNumber(value, { maximumFractionDigits: 2 })}%`;

// '2026-11-25' → '11월 25일'
function dayText(date) {
  const [, month, day] = date.split('-').map(Number);
  return `${month}월 ${day}일`;
}

// 다 갚는 날 '2051년 6월 (앞으로 24년 7개월)'
function payoffText(date) {
  const months = Math.max(0, parseMonth(date) - currentMonthIndex());
  return `${formatMonthIndex(parseMonth(date))} (앞으로 ${durationText(months)})`;
}

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
  // 연금 계좌 연결: 그 계좌의 보유 종목 평가금액 + 예수금
  return valueByAccount(valuePortfolio(state.holdings, { prices: market.prices, fxRate: market.fx.rate }).rows, cashInKRW(state.cash, market.fx.rate).byAccount);
}

export function render(root, { getState, updateState, subscribe }) {
  function draw() {
    clear(root);
    const state = getState();
    const { settings } = state;
    const money = (value) => formatMoney(value, { unit: settings.displayUnit });
    // 대출의 갚을 돈·원금·이자는 은행 앱 금액과 맞춰 볼 수 있게 원 단위까지
    const won = (value) => formatMoney(value, { unit: 'won' });
    const accountValues = accountValuesOf(state);

    if (!settings.birthYear) {
      root.append(el('p', { class: 'banner banner-info' },
        '연금을 받기 시작하는 때를 계산하려면 ', el('a', { href: '#settings', text: '설정' }), '에서 출생연도를 입력해 주세요.'));
    }

    // ── 공제회·예적금 ──
    const nowMonth = currentMonthIndex();
    const assetList = state.otherAssets.length === 0
      ? el('p', { class: 'muted', text: '아직 입력한 공제회·예적금이 없어요.' })
      : el('ul', { class: 'asset-list' }, state.otherAssets.map((asset) => {
        // 기준일 금액에서 월 납입액·기준 이율로 쌓은 오늘 추정 금액
        const estimate = estimateOtherAssetNow(asset, nowMonth);
        const plan = [
          asset.monthlyContribution > 0 ? `월 ${money(asset.monthlyContribution)} 납입 · ${formatYearMonth(asset.contributionEndDate)}까지` : '추가 납입 없음',
          asset.payoutDate ? `${formatYearMonth(asset.payoutDate)} 수령` : null,
        ].filter(Boolean).join(' · ');
        return el('li', {}, el('button', {
          type: 'button', class: 'asset-item', onClick: () => openOtherAssetForm({ asset, updateState }),
        },
        el('span', { class: 'asset-item-head' },
          el('span', { class: 'asset-name' }, el('span', { text: asset.name }), el('span', { class: 'badge badge-tiny', text: asset.type }), staleBadge(asset)),
          el('span', { class: 'asset-value num', text: money(estimate.balance) })),
        estimate.estimated
          ? el('span', { class: 'asset-meta', text: `오늘 추정 금액 · ${formatDate(asset.baseDate)} 기준 ${money(asset.balance)}에 그 뒤 ${estimate.months}개월 납입·이자를 더했어요` })
          : null,
        el('span', { class: 'asset-meta', text: `${formatDate(asset.baseDate)} 기준${asset.accruedInterest > 0 ? ` · 원금 ${money(asset.balance - asset.accruedInterest)} + 이자 ${money(asset.accruedInterest)}` : ''}` }),
        el('span', { class: 'asset-meta', text: `${rateText(asset.interestRates)} · ${asset.compounding}${asset.applyTax ? ` · 세후 계산(세율 ${pct(asset.taxRate)})` : ''}` }),
        el('span', { class: 'asset-meta', text: plan })));
      }));

    root.append(el('section', { class: 'card asset-section' },
      el('div', { class: 'asset-section-head' },
        el('h2', { class: 'section-title', text: '공제회·예적금' }),
        el('button', { type: 'button', class: 'btn btn-small btn-primary', text: '+ 추가', 'aria-label': '공제회·예적금 추가', onClick: () => openOtherAssetForm({ updateState }) })),
      assetList,
      state.otherAssets.some((asset) => estimateOtherAssetNow(asset, nowMonth).estimated)
        ? el('p', { class: 'muted small', text: '금액은 적어 둔 기준일부터 월 납입액과 기준 이율로 계산한 오늘 추정 금액이에요. 공제회·은행 앱의 금액과 다르면 눌러서 고쳐 주세요. 고친 날이 새 기준일이 돼요.' })
        : null));

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
            ? `${pension.linkedAccount} 계좌 보유 종목·예수금 금액을 써요 · ${rateText(pension.expectedReturns)}`
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

    // ── 부동산 ──
    const today = todayString();
    const realEstateList = state.realEstate.length === 0
      ? el('p', { class: 'muted', text: '아직 입력한 부동산이 없어요. 집이 있으면 시세를 적어 두세요. 순자산(가진 것 − 빌린 돈)에 들어가요.' })
      : el('ul', { class: 'asset-list' }, state.realEstate.map((item) => {
        // 실거래가로 자동 계산하는 아파트: 평균과 기간·건수를 함께, 거래가 없으면 직접 적은 값
        let source = `${formatDate(item.baseDate)} 기준 시세 · 직접 적은 값`;
        if (item.auto) {
          const where = `${item.auto.name} ${autoAreaText(item.auto)}`;
          if (item.market?.average) source = `${aptLabel(item.market)} · ${where}`;
          else if (item.market) source = `최근 1년 동안 거래가 없어 직접 적은 시세를 써요 · ${where}`;
          else source = `실거래가를 아직 받지 못했어요 · ${where}`;
        }
        return el('li', {}, el('button', {
          type: 'button', class: 'asset-item', onClick: () => openRealEstateForm({ item, getState, updateState }),
        },
        el('span', { class: 'asset-item-head' },
          el('span', { class: 'asset-name' }, el('span', { text: item.name }), el('span', { class: 'badge badge-tiny', text: item.auto ? '실거래가' : item.kind }), item.auto ? null : staleBadge(item)),
          el('span', { class: 'asset-value num', text: money(realEstateValue(item)) })),
        el('span', { class: 'asset-meta', text: source }),
        item.auto && item.market?.fetchedAt ? el('span', { class: 'asset-meta', text: `${formatDate(item.market.fetchedAt.slice(0, 10))}에 받음 · 일주일마다 새로 받아요` }) : null));
      }));
    root.append(el('section', { class: 'card asset-section' },
      el('div', { class: 'asset-section-head' },
        el('h2', { class: 'section-title', text: '부동산' }),
        el('button', { type: 'button', class: 'btn btn-small btn-primary', text: '+ 추가', 'aria-label': '부동산 추가', onClick: () => openRealEstateForm({ getState, updateState }) })),
      realEstateList,
      state.realEstate.length > 0
        ? el('p', { class: 'muted small', text: `합계 ${money(realEstateTotal(state.realEstate))} · 직접 적은 시세는 1년에 한두 번 확인해서 고쳐 주세요. 아파트는 실거래가 평균으로 자동 계산할 수 있어요.` })
        : null));

    // ── 대출 ──
    const loans = loansSummary(state.loans, { today });
    const loanList = state.loans.length === 0
      ? el('p', { class: 'muted', text: '아직 입력한 대출이 없어요. 지금 남은 대출금·금리·매월 상환액을 적으면 오늘 남은 금액과 다 갚는 날을 계산해 드려요.' })
      : el('ul', { class: 'asset-list' }, loans.items.map(({ loan, status }) => {
        let plan = '';
        if (status.finished) plan = '다 갚았어요. 삭제해도 돼요.';
        else if (status.next) plan = `${dayText(status.next.date)} 갚을 돈 ${won(status.next.payment)} (원금 ${won(status.next.principal)} + 이자 ${won(status.next.interest)})`;
        const warn = status.error === 'too-small'
          ? '매월 상환액이 이자보다 적어서 원금이 줄지 않아요. 눌러서 금액을 확인해 주세요.'
          : !status.paysOff && !status.finished ? '만기를 적으면 다 갚는 날을 알려 드려요.' : null;
        return el('li', {}, el('button', { type: 'button', class: 'asset-item', onClick: () => openLoanForm({ loan, updateState }) },
          el('span', { class: 'asset-item-head' },
            el('span', { class: 'asset-name' }, el('span', { text: loan.name }), el('span', { class: 'badge badge-tiny', text: LOAN_METHOD_LABELS[loan.method] }), staleBadge(loan)),
            el('span', { class: 'asset-value num loan-value', text: money(status.balance) })),
          el('span', { class: 'asset-meta', text: `${loan.type} · 연 ${pct(loan.rate)} · 남은 대출금${status.estimated ? `(${formatDate(loan.baseDate)} 기준 ${money(loan.balance)}에서 갚은 만큼 뺀 오늘 추정)` : ''}` }),
          plan ? el('span', { class: 'asset-meta', text: plan }) : null,
          status.payoffDate && !status.finished ? el('span', { class: 'asset-meta', text: `다 갚는 날 ${payoffText(status.payoffDate)} · 앞으로 낼 이자 약 ${money(status.interestLeft)}` }) : null,
          warn ? el('span', { class: 'asset-meta warn-text', text: warn }) : null));
      }));
    root.append(el('section', { class: 'card asset-section' },
      el('div', { class: 'asset-section-head' },
        el('h2', { class: 'section-title', text: '대출' }),
        el('button', { type: 'button', class: 'btn btn-small btn-primary', text: '+ 대출 추가', onClick: () => openLoanForm({ updateState }) })),
      state.loans.length > 0
        ? el('p', { class: 'loan-summary' },
          el('strong', { text: `매달 갚는 돈 ${money(loans.monthlyPayment)}` }),
          ` (원금 ${won(loans.monthlyPrincipal)} · 이자 ${won(loans.monthlyInterest)}) · 남은 대출금 합계 ${money(loans.balance)}`)
        : null,
      loanList));

    root.append(el('p', { class: 'muted small', text: '공제회·예적금과 연금은 사고팔 수 없어서 리밸런싱에는 넣지 않아요. 총자산과 분산 분석의 "전체" 보기, 미래 예측에 들어가요. 계좌에 연결한 적립형 연금은 보유 종목으로 이미 계산되므로 총자산에 다시 더하지 않아요. 부동산과 대출은 대시보드의 순자산(총자산 + 부동산 − 대출)에 들어가요.' }));
  }

  draw();
  const unsubscribeState = subscribe(draw);
  const unsubscribeMarket = subscribeMarket(draw);
  return () => {
    unsubscribeState();
    unsubscribeMarket();
  };
}
