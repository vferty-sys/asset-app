// 예수금(계좌에 남아 있는 현금): 보유 종목 화면의 예수금 칸과 입력 창.
// 총자산·계좌 금액에 더하고, 리밸런싱할 때는 살 돈으로 쓴다 (../cash.js).
import { ACCOUNTS } from '../constants.js';
import { cashInKRW, normalizeCash } from '../cash.js';
import { el, helpTip, openModal, showToast } from '../dom.js';
import { formatNumber } from '../format.js';
import { parseNumberInput } from '../validate.js';
import { createField, numberInput } from './form.js';

// 연금저축·IRP·ISA는 국내 상장 상품만 사서 달러 예수금이 없다
const USD_ACCOUNTS = ['일반', '기타'];

const HELP = [
  '증권 계좌에 남아 있는 현금이에요. 증권사 앱의 "예수금"(또는 "주문 가능 금액")을 보면 돼요.',
  '총자산과 계좌별 금액(연금 계좌 연결 포함)에 더하고, 리밸런싱할 때는 살 돈으로 함께 써요.',
];

const usdText = (amount) => `$${formatNumber(amount, { maximumFractionDigits: 2 })}`;

export function cashCard({ state, money, fxRate, getState, updateState }) {
  const cash = state.cash ?? {};
  const accounts = Object.keys(cash);
  const krw = cashInKRW(cash, fxRate);
  const list = accounts.length === 0
    ? el('p', { class: 'muted', text: '아직 적은 예수금이 없어요. 계좌에 남아 있는 현금이 있으면 적어 두세요.' })
    : el('ul', { class: 'cash-list' }, accounts.map((account) => {
      const { KRW = 0, USD = 0 } = cash[account];
      const parts = [KRW > 0 ? money(KRW) : null, USD > 0 ? usdText(USD) : null].filter(Boolean).join(' + ');
      return el('li', { class: 'cash-row' },
        el('span', { class: 'cash-account', text: account }),
        el('span', { class: 'cash-value num', text: parts }));
    }));
  return el('section', { class: 'card cash-card', 'aria-label': '예수금' },
    el('div', { class: 'cash-head' },
      el('h2', { class: 'section-title' }, '예수금 ', helpTip('예수금', HELP)),
      krw.total > 0 ? el('span', { class: 'cash-total num', text: `합계 ${money(krw.total)}` }) : null),
    list,
    krw.missingUsd > 0 ? el('p', { class: 'muted small', text: `달러 환율이 없어서 ${usdText(krw.missingUsd)}는 합계에서 뺐어요.` }) : null,
    el('div', { class: 'toolbar' },
      el('button', { type: 'button', class: 'btn', text: accounts.length ? '예수금 고치기' : '예수금 입력', onClick: () => openCashForm({ getState, updateState }) })));
}

export function openCashForm({ getState, updateState }) {
  const current = getState().cash ?? {};
  const fields = ACCOUNTS.map((account) => {
    const krw = createField({ label: `${account} 원화`, control: numberInput({ value: current[account]?.KRW ?? '', placeholder: '0' }), suffix: '원' });
    const usd = USD_ACCOUNTS.includes(account)
      ? createField({ label: `${account} 달러`, control: numberInput({ value: current[account]?.USD ?? '', placeholder: '0' }), suffix: '달러' })
      : null;
    return { account, krw, usd };
  });
  const form = el('form', { class: 'form', novalidate: true },
    el('p', { class: 'muted small', text: '증권사 앱의 계좌별 "예수금"을 적어 주세요. 없는 계좌는 비워 두면 돼요.' }),
    fields.map(({ krw, usd }) => el('div', { class: usd ? 'form-pair' : '' }, krw.element, usd?.element)));
  form.id = 'cash-form';
  const save = el('button', { type: 'submit', form: form.id, class: 'btn btn-primary', text: '저장' });
  const cancel = el('button', { type: 'button', class: 'btn', text: '취소' });
  const { close } = openModal({ title: '예수금', body: form, footer: [el('span', { class: 'spacer' }), cancel, save] });
  cancel.addEventListener('click', close);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const next = {};
    let ok = true;
    const read = (view) => {
      if (!view) return 0;
      const value = parseNumberInput(view.control.value);
      const valid = value === null || (Number.isFinite(value) && value >= 0);
      view.setError(valid ? null : '0 이상의 숫자로 입력해 주세요.');
      if (!valid) ok = false;
      return valid && value !== null ? value : 0;
    };
    for (const { account, krw, usd } of fields) next[account] = { KRW: read(krw), USD: read(usd) };
    if (!ok) return;
    updateState((draft) => { draft.cash = normalizeCash(next); });
    close();
    showToast('예수금을 저장했어요');
  });
}
