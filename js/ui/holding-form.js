// 보유 종목 추가·수정 창

import {
  ACCOUNTS, ASSET_CLASSES, BROAD_ASSET_CLASSES, COUNTRY_OPTIONS, ETF_SPREADS, ETF_SPREAD_LABELS, SECTOR_OPTIONS,
} from '../constants.js';
import { guessCountry } from '../classify.js';
import { COUNTRY_PRESETS, COUNTRY_WEIGHTS, GLOBAL_COUNTRY, presetMix } from '../country-weights.js';
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
  country: [
    '실제로 투자하는 나라예요. 개별 주식은 본사가 있는 나라예요.',
    'ETF는 상장된 나라가 아니라 담은 회사들의 나라로 적어요. 예: TIGER 미국S&P500은 한국에 상장됐지만 미국이에요.',
    '한 나라: S&P500·코스피200·니케이225처럼 한 나라에만 투자하는 ETF',
    '비중표: MSCI World·ACWI·신흥국처럼 여러 나라에 투자하는 ETF를 비중표 비율대로 나눠요',
    '직접 나누기: 운용사 홈페이지의 나라별 비중을 보고 직접 적어요',
    '미분류: 비중표에 없는 다국가 ETF. 글로벌(다국가)로 모아 계산해요',
  ],
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
    countryPreset: '',
    sectorRows: [{ name: '', percent: '100' }],
    dividendPerShare: '',
    memo: '',
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// 국가·섹터 비율 줄. single이면 하나만 고르고, 아니면 이름+비율 여러 줄을 입력한다.
function createMixRows({ label, presets, rows, single, onChange }) {
  let isSingle = single;
  let current = rows.map((row) => ({ name: row.name ?? '', percent: row.percent == null ? '' : String(row.percent) }));
  const container = el('div', { class: 'mix-editor' });

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
    element: container,
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
      draw();
    },
  };
}

// 섹터 입력 (개별 주식은 하나, ETF는 비율로 나눔)
function createMixEditor({ label, presets, rows, single, help, onChange }) {
  const control = createMixRows({ label, presets, rows, single, onChange });
  const field = createField({ label, help, control: control.element, group: true, hint: single ? '' : ETF_MIX_HINT });
  return {
    element: field.element,
    setError: field.setError,
    getRows: control.getRows,
    setRows: control.setRows,
    isBlank: control.isBlank,
    setSingle(next) {
      control.setSingle(next);
      field.setHint(next ? '' : ETF_MIX_HINT);
    },
  };
}

// 국가 입력. 국가는 실제 투자 대상 기준이다 (ETF는 상장된 나라가 아니라 담은 회사들의 나라).
//  개별 주식: 본사 나라 하나
//  ETF: 한 나라(S&P500·코스피200 …) / 비중표(MSCI World 같은 다국가 지수, js/country-weights.js) /
//       직접 나누기(운용사 자료를 보고 비율 입력) / 미분류(비중표에 없는 다국가 → 글로벌(다국가))
const COUNTRY_MODES = [['single', '한 나라'], ['preset', '비중표'], ['split', '직접 나누기'], ['global', '미분류']];
const COUNTRY_CHOICES = COUNTRY_OPTIONS.filter((name) => name !== GLOBAL_COUNTRY);
const PRESET_HINT = `비중표(${COUNTRY_WEIGHTS.meta.updated_at} 기준, 대략값)로 나라별로 나눠 계산해요. 비중표를 고치면 바로 반영돼요.`;

function countryModeOf({ type, rows, preset }) {
  if (type !== 'etf') return 'single';
  if (preset) return 'preset';
  const named = rows.filter((row) => row.name);
  if (named.length === 1 && named[0].name === GLOBAL_COUNTRY) return 'global';
  return named.length > 1 ? 'split' : 'single';
}

function createCountryEditor({ rows, preset, type, onChange }) {
  const box = el('div', { class: 'country-editor' });
  const field = createField({ label: '국가', help: HELP.country, control: box, group: true });
  let isEtf = type === 'etf';
  let mode = countryModeOf({ type, rows, preset });

  const rowsControl = createMixRows({
    label: '국가', presets: COUNTRY_CHOICES, rows: mode === 'global' || mode === 'preset' ? [{ name: '', percent: '100' }] : rows,
    single: mode !== 'split', onChange,
  });
  const presetSelect = selectInput(COUNTRY_PRESETS, COUNTRY_PRESETS.includes(preset) ? preset : '', { placeholder: '다국가 지수를 골라 주세요' });
  presetSelect.setAttribute('aria-label', '국가 비중표 항목');
  const presetPreview = el('p', { class: 'country-preview muted small' });
  const presetBox = el('div', { class: 'country-preset' }, presetSelect, presetPreview);
  const globalNote = el('p', {
    class: 'muted small',
    text: `나라별로 나누지 않고 '${GLOBAL_COUNTRY}'로 모아 계산해요. 쏠림 경고에서는 빼고, 분석 화면에 "국가별 분해 미반영"으로 알려 드려요.`,
  });
  const modeControl = segmented({
    options: COUNTRY_MODES,
    value: mode,
    onChange: (next) => {
      setMode(next);
      onChange?.();
    },
  });
  modeControl.element.classList.add('country-modes');
  modeControl.element.setAttribute('aria-label', 'ETF 국가 입력 방식');
  box.append(modeControl.element, rowsControl.element, presetBox, globalNote);

  function showPreview() {
    const mix = presetMix(presetSelect.value);
    presetPreview.textContent = mix
      ? Object.entries(mix).map(([country, percent]) => `${country} ${percent}%`).join(' · ')
      : '';
  }
  presetSelect.addEventListener('change', () => {
    showPreview();
    onChange?.();
  });

  function setMode(next) {
    mode = isEtf ? next : 'single';
    modeControl.value = mode;
    modeControl.element.hidden = !isEtf;
    rowsControl.element.hidden = !(mode === 'single' || mode === 'split');
    rowsControl.setSingle(mode !== 'split');
    presetBox.hidden = mode !== 'preset';
    globalNote.hidden = mode !== 'global';
    const hints = { single: isEtf ? 'S&P500·코스피200처럼 한 나라에만 투자하는 ETF예요.' : '', preset: PRESET_HINT, split: ETF_MIX_HINT, global: '' };
    field.setHint(hints[mode]);
    showPreview();
  }
  setMode(mode);

  return {
    element: field.element,
    setError: field.setError,
    setType(nextType) {
      isEtf = nextType === 'etf';
      setMode(isEtf ? mode : 'single');
    },
    // 목록·짐작한 값으로 채운다: { countryMix, countryPreset }
    setValue({ countryMix = null, countryPreset = null } = {}) {
      const nextRows = Object.entries(countryMix ?? {}).map(([name, percent]) => ({ name, percent: String(percent) }));
      const nextMode = countryModeOf({ type: isEtf ? 'etf' : 'stock', rows: nextRows, preset: countryPreset });
      if (nextMode === 'preset') presetSelect.value = countryPreset;
      if (nextMode === 'single' || nextMode === 'split') {
        rowsControl.setSingle(nextMode === 'single');
        rowsControl.setRows(nextMode === 'single' ? [{ name: nextRows[0]?.name ?? '', percent: '100' }] : nextRows);
      }
      setMode(nextMode);
    },
    // 검사(validateHolding)에 넘길 값
    getValue() {
      if (mode === 'preset') return { countryRows: [], countryPreset: presetSelect.value || null };
      if (mode === 'global') return { countryRows: [{ name: GLOBAL_COUNTRY, percent: '100' }], countryPreset: null };
      return { countryRows: rowsControl.getRows(), countryPreset: null };
    },
    isBlank() {
      if (mode === 'preset') return !presetSelect.value;
      if (mode === 'global') return false;
      return rowsControl.isBlank();
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
      countryEditor.setType(type);
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

  const countryEditor = createCountryEditor({
    rows: input.countryRows, preset: input.countryPreset, type: input.type,
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

  // 티커를 적으면 거래소를 보고 통화를 채운다 (직접 고른 적이 없을 때만).
  // 국가는 거래소가 아니라 투자 대상으로: 종목 목록에 있으면 목록 값, 없으면 이름으로 짐작한다.
  // (예: KRX:360750 TIGER 미국S&P500 → 한국이 아니라 미국) 짐작할 수 없는 ETF는 비워 두고 직접 고르게 한다.
  tickerInput.addEventListener('change', () => {
    tickerInput.value = normalizeTicker(tickerInput.value);
    const guess = guessFromTicker(tickerInput.value);
    if (guess && !currencyTouched) {
      currencyControl.value = guess.currency;
      applyCurrency(guess.currency);
    }
    if (countryTouched && !countryEditor.isBlank()) return;
    const listed = findByTicker(stockItems, tickerInput.value);
    const country = listed?.countryMix ? listed : guessCountry({ name: nameField.control.value, ticker: tickerInput.value, type: typeControl.value });
    if (country) countryEditor.setValue(country);
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
    countryEditor.setType(item.type);
    sectorEditor.setSingle(item.type === 'stock');
    currencyControl.value = item.currency;
    applyCurrency(item.currency);
    currencyTouched = true;
    if (item.countryMix) {
      countryEditor.setValue(item);
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
      ...countryEditor.getValue(),
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
