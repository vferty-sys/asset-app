// 보유 종목 추가·수정 창

import {
  ACCOUNTS, ASSET_CLASSES, BROAD_ASSET_CLASSES, COUNTRY_OPTIONS, ETF_SPREADS, ETF_SPREAD_LABELS, SECTOR_OPTIONS,
} from '../constants.js';
import { guessEtfSpread, guessFromTicker, holdingToInput, normalizeTicker, validateHolding } from '../holding.js';
import { findByTicker, loadStockList } from '../stock-list.js';
import { parseNumberInput } from '../validate.js';
import { el, clear, closeIcon, confirmDialog, openModal, showToast, uid } from '../dom.js';
import { createField, numberInput, segmented, selectInput, textInput } from './form.js';
import { attachStockPicker } from './stock-picker.js';

const TYPE_OPTIONS = [['stock', '개별 주식'], ['etf', 'ETF']];
const CURRENCY_OPTIONS = [['KRW', '원화 (KRW)'], ['USD', '달러 (USD)']];
const ETF_MIX_HINT = 'ETF가 담고 있는 비율대로 나눠 적어요. 운용사 홈페이지에서 확인할 수 있어요.';

const HELP = {
  ticker: [
    '구글 시트의 GOOGLEFINANCE와 같은 형식으로 적어요.',
    '국내: KRX:005930 (코스닥은 KOSDAQ:종목번호)',
    '미국: NASDAQ:QQQ, NYSEARCA:SCHD 처럼 거래소:종목코드',
  ],
  assetClass: [
    '성장주: 회사가 빠르게 커서 주가가 오르길 기대하는 주식',
    '배당주: 꾸준히 배당금을 주는 주식',
    '채권: 나라나 회사에 돈을 빌려주고 이자를 받는 상품 (채권 ETF 등)',
    '현금성: 예금처럼 거의 움직이지 않는 상품 (MMF·단기채 ETF 등)',
    '기타: 금·원자재·리츠 등',
  ],
  avgPrice: '한 주를 평균 얼마에 샀는지예요. 증권사 앱의 "평균단가"를 보면 돼요.',
  manualPrice: '구글 시트에서 가격을 받아오지 못할 때 이 값을 써요. 비워 두면 평단가로 계산하고 경고를 보여줘요.',
  country: '회사(또는 ETF가 담은 회사들)가 어느 나라에 있는지예요.',
  sector: '섹터는 기술·금융·소비재처럼 회사가 하는 일의 분야예요.',
  dividend: '1년 동안 1주당 받는 배당금 합계예요. 모르면 비워 두세요.',
  spread: [
    'ETF가 회사들을 얼마나 넓게 담았는지예요. 건강도 점수와 쏠림 경고에서 ETF 하나를 몇 종목으로 볼지 정해요.',
    '시장 전체형: S&P500·코스피200·나스닥100·전세계 주식처럼 시장 전체를 담은 ETF (10종목으로 봐요)',
    '업종·테마형: 반도체·2차전지·배당·리츠처럼 한 업종이나 주제의 회사들을 담은 ETF (3종목으로 봐요)',
    '집중형: 레버리지·인버스·단일 종목처럼 몇 곳에 몰린 ETF (1종목으로 봐요)',
  ],
};

const currencySuffix = (currency) => (currency === 'USD' ? '달러' : '원');

function emptyInput() {
  return {
    id: '',
    name: '',
    ticker: '',
    type: 'stock',
    etfSpread: '',
    currency: 'KRW',
    quantity: '',
    avgPrice: '',
    manualPrice: '',
    account: '일반',
    assetClass: '',
    countryRows: [{ name: '', percent: '100' }],
    sectorRows: [{ name: '', percent: '100' }],
    dividendPerShare: '',
    memo: '',
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// 국가·섹터 입력. single이면 하나만 고르고, 아니면 이름+비율 여러 줄을 입력한다.
function createMixEditor({ label, presets, rows, single, help, onChange }) {
  let isSingle = single;
  let current = rows.map((row) => ({ name: row.name ?? '', percent: row.percent == null ? '' : String(row.percent) }));
  const container = el('div', { class: 'mix-editor' });
  const field = createField({ label, help, control: container, group: true, hint: single ? '' : ETF_MIX_HINT });

  // CSV·백업으로 들어온, 목록에 없는 이름도 선택지에 남겨 둔다.
  const optionsFor = (name) => (name && !presets.includes(name) ? [...presets, name] : presets);

  function draw() {
    clear(container);
    if (isSingle) {
      const select = selectInput(optionsFor(current[0]?.name), current[0]?.name ?? '', { placeholder: '골라 주세요' });
      select.setAttribute('aria-label', label);
      select.addEventListener('change', () => {
        current = [{ name: select.value, percent: '100' }];
        onChange?.();
      });
      container.append(select);
      return;
    }

    const sumNode = el('p', { class: 'mix-sum', 'aria-live': 'polite' });
    const updateSum = () => {
      const total = round2(current.reduce((sum, row) => {
        const value = parseNumberInput(row.percent);
        return Number.isFinite(value) ? sum + value : sum;
      }, 0));
      const complete = Math.abs(total - 100) < 0.01;
      sumNode.classList.toggle('is-warn', !complete);
      sumNode.textContent = complete ? '합계 100%' : `합계 ${total}% · 100%가 되도록 맞춰 주세요`;
    };

    const list = el('div', { class: 'mix-rows' }, current.map((row, index) => {
      const select = selectInput(optionsFor(row.name), row.name, { placeholder: '골라 주세요' });
      select.setAttribute('aria-label', `${label} ${index + 1}`);
      select.addEventListener('change', () => {
        row.name = select.value;
        onChange?.();
      });
      const percent = textInput({ value: row.percent, inputmode: 'decimal', placeholder: '0' });
      percent.setAttribute('aria-label', `${label} ${index + 1} 비율(%)`);
      percent.addEventListener('input', () => {
        row.percent = percent.value;
        updateSum();
        onChange?.();
      });
      const remove = el('button', {
        type: 'button', class: 'icon-btn', 'aria-label': `${label} ${index + 1} 지우기`, disabled: current.length === 1,
      }, closeIcon());
      remove.addEventListener('click', () => {
        current.splice(index, 1);
        draw();
        onChange?.();
      });
      return el('div', { class: 'mix-row' },
        select,
        el('div', { class: 'input-affix' }, percent, el('span', { class: 'input-suffix', 'aria-hidden': 'true', text: '%' })),
        remove);
    }));

    const add = el('button', { type: 'button', class: 'btn btn-small', text: `+ ${label} 추가` });
    add.addEventListener('click', () => {
      const used = new Set(current.map((row) => row.name));
      current.push({ name: presets.find((name) => !used.has(name)) ?? '', percent: '' });
      draw();
      container.querySelectorAll('.mix-row input')[current.length - 1]?.focus();
    });
    container.append(list, el('div', { class: 'mix-foot' }, add, sumNode));
    updateSum();
  }

  draw();
  return {
    element: field.element,
    setError: field.setError,
    getRows: () => current.map((row) => ({ ...row })),
    setRows(next) {
      current = next.map((row) => ({ ...row }));
      draw();
    },
    isBlank: () => current.every((row) => !row.name),
    setSingle(next) {
      if (next === isSingle) return;
      if (next) {
        const best = current.filter((row) => row.name)
          .sort((a, b) => (parseNumberInput(b.percent) || 0) - (parseNumberInput(a.percent) || 0))[0];
        current = [{ name: best?.name ?? '', percent: '100' }];
      } else {
        current = [{ name: current[0]?.name ?? '', percent: '100' }];
      }
      isSingle = next;
      field.setHint(next ? '' : ETF_MIX_HINT);
      draw();
    },
  };
}

export function openHoldingForm({ holding = null, getState, updateState }) {
  const isEdit = Boolean(holding);
  const input = isEdit ? holdingToInput(holding) : emptyInput();
  let currencyTouched = isEdit;
  let countryTouched = isEdit;
  // 저장된 ETF의 분산 정도는 사용자가 정한 값으로 본다 (이름을 바꿔도 다시 짐작하지 않음)
  let spreadTouched = isEdit && input.type === 'etf';

  const nameHint = isEdit ? '' : '종목명이나 종목코드를 치면 목록에서 고를 수 있어요. 고르면 나머지 칸이 채워져요.';
  const nameField = createField({ label: '종목명', hint: nameHint, control: textInput({ value: input.name, placeholder: '예: 삼성전자, 애플, KODEX 200', maxlength: 60 }) });

  const tickerInput = textInput({ value: input.ticker, placeholder: '예: KRX:005930' });
  tickerInput.spellcheck = false;
  tickerInput.setAttribute('autocapitalize', 'characters');
  const tickerField = createField({ label: '티커', help: HELP.ticker, control: tickerInput });

  const typeControl = segmented({
    options: TYPE_OPTIONS,
    value: input.type,
    onChange: (type) => {
      countryEditor.setSingle(type === 'stock');
      sectorEditor.setSingle(type === 'stock');
      refreshSpread();
    },
  });
  const typeField = createField({ label: '종류', control: typeControl.element, group: true });

  const spreadControl = segmented({
    options: ETF_SPREADS.map((spread) => [spread, ETF_SPREAD_LABELS[spread]]),
    value: input.etfSpread || guessEtfSpread({ name: input.name, ticker: input.ticker }),
    onChange: () => {
      spreadTouched = true;
      refreshSpread();
    },
  });
  const spreadField = createField({ label: 'ETF 분산 정도', help: HELP.spread, control: spreadControl.element, group: true });

  const currencyControl = segmented({
    options: CURRENCY_OPTIONS,
    value: input.currency,
    onChange: (currency) => {
      currencyTouched = true;
      applyCurrency(currency);
    },
  });
  const currencyField = createField({ label: '통화', control: currencyControl.element, group: true });

  const quantityField = createField({ label: '보유 수량', control: numberInput({ value: input.quantity, placeholder: '0' }), suffix: '주' });
  const avgPriceField = createField({ label: '평단가', help: HELP.avgPrice, control: numberInput({ value: input.avgPrice, placeholder: '0' }), suffix: '원' });
  const accountField = createField({ label: '계좌', control: selectInput(ACCOUNTS, input.account) });
  const assetClassField = createField({
    label: '자산군', help: HELP.assetClass, control: selectInput(ASSET_CLASSES, input.assetClass, { placeholder: '골라 주세요' }),
  });

  const countryEditor = createMixEditor({
    label: '국가', presets: COUNTRY_OPTIONS, rows: input.countryRows, single: input.type === 'stock', help: HELP.country,
    onChange: () => { countryTouched = true; },
  });
  const sectorEditor = createMixEditor({
    label: '섹터', presets: SECTOR_OPTIONS, rows: input.sectorRows, single: input.type === 'stock', help: HELP.sector,
  });

  const manualPriceField = createField({ label: '현재가 (선택)', help: HELP.manualPrice, control: numberInput({ value: input.manualPrice }), suffix: '원' });
  const dividendField = createField({ label: '연간 주당 배당금 (선택)', help: HELP.dividend, control: numberInput({ value: input.dividendPerShare }), suffix: '원' });
  const memoField = createField({ label: '메모 (선택)', control: el('textarea', { class: 'input textarea', rows: '2', maxlength: '200', value: input.memo }) });

  function applyCurrency(currency) {
    const suffix = currencySuffix(currency);
    [avgPriceField, manualPriceField, dividendField].forEach((field) => field.setSuffix(suffix));
    const fractional = getState().settings.allowFractionalUS;
    quantityField.setHint(currency === 'USD'
      ? (fractional ? '소수점으로 입력할 수 있어요. (예: 0.5)' : '소수점 수량은 설정에서 "미국 주식 소수점 매매"를 켜면 입력할 수 있어요.')
      : '');
  }
  applyCurrency(input.currency);

  // 티커를 적으면 거래소를 보고 통화·국가를 채운다 (직접 고른 적이 없을 때만).
  tickerInput.addEventListener('change', () => {
    tickerInput.value = normalizeTicker(tickerInput.value);
    const guess = guessFromTicker(tickerInput.value);
    if (!guess) return;
    if (!currencyTouched) {
      currencyControl.value = guess.currency;
      applyCurrency(guess.currency);
    }
    if (!countryTouched || countryEditor.isBlank()) countryEditor.setRows([{ name: guess.country, percent: '100' }]);
  });

  // ETF 분산 정도는 ETF일 때만 보여준다. 채권·현금성 ETF는 점수에서 시장 전체형처럼 보므로 고를 필요가 없다.
  // 직접 고른 적이 없으면 이름·티커를 보고 짐작해 둔다.
  function refreshSpread() {
    const isEtf = typeControl.value === 'etf';
    const broad = BROAD_ASSET_CLASSES.includes(assetClassField.control.value);
    spreadField.element.hidden = !isEtf || broad;
    if (isEtf && !spreadTouched) spreadControl.value = guessEtfSpread({ name: nameField.control.value, ticker: tickerInput.value });
    spreadField.setHint(isEtf && !spreadTouched ? '종목명을 보고 먼저 골라 두었어요. 다르면 바꿔 주세요.' : '');
  }
  [nameField.control, tickerInput, assetClassField.control].forEach((control) => control.addEventListener('change', refreshSpread));
  refreshSpread();

  // ── 종목 목록에서 고르면 티커·종류·통화·국가·섹터·자산군·분산 정도를 한 번에 채운다 ──
  let stockItems = [];
  const rowsOf = (mix) => Object.entries(mix).map(([name, percent]) => ({ name, percent: String(percent) }));
  function applyStock(item) {
    nameField.control.value = item.name;
    tickerInput.value = item.ticker;
    typeControl.value = item.type;
    countryEditor.setSingle(item.type === 'stock');
    sectorEditor.setSingle(item.type === 'stock');
    currencyControl.value = item.currency;
    applyCurrency(item.currency);
    currencyTouched = true;
    if (item.countryMix) {
      countryEditor.setRows(rowsOf(item.countryMix));
      countryTouched = true;
    }
    if (item.sectorMix) sectorEditor.setRows(rowsOf(item.sectorMix));
    if (item.assetClass) assetClassField.control.value = item.assetClass;
    if (item.type === 'etf' && item.etfSpread) {
      spreadControl.value = item.etfSpread;
      spreadTouched = true;
    }
    refreshSpread();
    const notes = ['목록에서 골라 티커·종류·통화·국가·섹터·자산군을 채웠어요. 맞는지 확인해 주세요.'];
    if (item.approx) notes.push('ETF의 국가·섹터 비율은 지수 구성을 바탕으로 한 대략값이에요. 정확한 비율은 운용사 홈페이지에서 볼 수 있어요.');
    if (!item.countryMix) notes.push('국가는 직접 골라 주세요.');
    if (!item.sectorMix) notes.push('섹터는 직접 골라 주세요.');
    nameField.setHint(notes.join(' '));
  }
  const picker = attachStockPicker({ input: nameField.control, field: nameField.element, getItems: () => stockItems, onPick: applyStock });
  nameField.control.addEventListener('input', () => nameField.setHint(nameHint));
  loadStockList()
    .then((items) => {
      stockItems = items;
      picker.refresh();
    })
    .catch(() => nameField.setHint('종목 목록을 불러오지 못했어요. 티커와 나머지 칸을 직접 입력해 주세요.'));
  // 종목명 없이 티커만 적었으면 목록에서 찾아 채운다
  tickerInput.addEventListener('change', () => {
    if (nameField.control.value.trim()) return;
    const item = findByTicker(stockItems, tickerInput.value);
    if (item) applyStock(item);
  });

  const views = {
    name: nameField,
    ticker: tickerField,
    type: typeField,
    etfSpread: spreadField,
    currency: currencyField,
    quantity: quantityField,
    avgPrice: avgPriceField,
    account: accountField,
    assetClass: assetClassField,
    countryMix: countryEditor,
    sectorMix: sectorEditor,
    manualPrice: manualPriceField,
    dividendPerShare: dividendField,
    memo: memoField,
  };

  const formId = uid('holding-form');
  const form = el('form', { class: 'form', id: formId, novalidate: true },
    nameField.element,
    tickerField.element,
    el('div', { class: 'form-pair' }, typeField.element, currencyField.element),
    spreadField.element,
    el('div', { class: 'form-pair' }, quantityField.element, avgPriceField.element),
    el('div', { class: 'form-pair' }, accountField.element, assetClassField.element),
    countryEditor.element,
    sectorEditor.element,
    el('div', { class: 'form-pair' }, manualPriceField.element, dividendField.element),
    memoField.element);

  const deleteButton = isEdit ? el('button', { type: 'button', class: 'btn btn-danger', text: '삭제' }) : null;
  const cancelButton = el('button', { type: 'button', class: 'btn', text: '취소' });
  const saveButton = el('button', { type: 'submit', form: formId, class: 'btn btn-primary', text: isEdit ? '저장' : '추가' });

  const { close } = openModal({
    title: isEdit ? '종목 수정' : '종목 추가',
    body: form,
    footer: [deleteButton, el('span', { class: 'spacer' }), cancelButton, saveButton],
  });
  cancelButton.addEventListener('click', close);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const state = getState();
    const result = validateHolding({
      id: input.id,
      name: nameField.control.value,
      ticker: tickerInput.value,
      type: typeControl.value,
      etfSpread: typeControl.value === 'etf' ? spreadControl.value : '',
      currency: currencyControl.value,
      quantity: quantityField.control.value,
      avgPrice: avgPriceField.control.value,
      manualPrice: manualPriceField.control.value,
      account: accountField.control.value,
      assetClass: assetClassField.control.value,
      countryRows: countryEditor.getRows(),
      sectorRows: sectorEditor.getRows(),
      dividendPerShare: dividendField.control.value,
      memo: memoField.control.value,
    }, { allowFractionalUS: state.settings.allowFractionalUS, existing: state.holdings });

    Object.entries(views).forEach(([key, view]) => view.setError(result.errors[key] ?? null));
    if (!result.ok) {
      const firstKey = Object.keys(views).find((key) => result.errors[key]);
      views[firstKey].element.querySelector('input, select, textarea')?.focus();
      return;
    }

    updateState((draft) => {
      const index = draft.holdings.findIndex((item) => item.id === result.value.id);
      if (index >= 0) draft.holdings[index] = result.value;
      else draft.holdings.push(result.value);
    });
    close();
    const warning = Object.values(result.warnings)[0];
    if (warning) showToast(`저장했어요. ${warning}`, 'warn', 4500);
    else showToast(isEdit ? '저장했어요' : '종목을 추가했어요');
  });

  deleteButton?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: '종목 삭제',
      message: `'${holding.name}'을(를) 삭제할까요? 삭제하면 되돌릴 수 없어요.`,
      confirmText: '삭제',
      danger: true,
    });
    if (!confirmed) return;
    updateState((draft) => {
      draft.holdings = draft.holdings.filter((item) => item.id !== holding.id);
    });
    close();
    showToast('삭제했어요');
  });
}
