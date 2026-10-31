// 리밸런싱 탭: 목표 비중 입력, 현재 vs 목표 비교, 계산 방법, 결과(매수·매도 목록, 남는 돈, 수수료·세금)

import { ACCOUNTS, ASSET_CLASSES } from '../constants.js';
import { valuePortfolio } from '../calc/valuation.js';
import { analyzeDiversification, holdingWeights } from '../calc/diversification.js';
import { rebalance, targetKeys } from '../calc/rebalance.js';
import { estimateCosts } from '../calc/tax.js';
import { getMarket, subscribeMarket } from '../market.js';
import { el, clear, helpTip, uid } from '../dom.js';
import { formatMoney, formatNumber, formatPercent, formatPrice } from '../format.js';
import { parseNumberInput } from '../validate.js';
import { createField, numberInput, segmented, textInput } from './form.js';

const MODE_OPTIONS = [['assetClass', '자산군 단위'], ['ticker', '종목 단위']];
const METHOD_OPTIONS = [['full', '전체 리밸런싱'], ['buyOnly', '매수만으로 맞추기']];
const ACTION_LABELS = { buy: '매수', sell: '매도', hold: '그대로' };
// 증권사 앱처럼 매수 빨강, 매도 파랑 (손익 색상 설정과 상관없이 고정)
const ACTION_BADGES = { buy: 'badge-buy', sell: 'badge-sell', hold: '' };

const HELP = {
  rebalance: [
    '리밸런싱은 비중이 목표에서 벗어났을 때 사고팔아 다시 맞추는 거예요.',
    '예: 주식이 많이 올라 70%가 됐다면 일부를 팔아 목표 60%로 되돌려요.',
  ],
  method: [
    '전체 리밸런싱: 많은 쪽은 팔고 모자란 쪽은 사서 목표에 맞춰요.',
    '매수만으로 맞추기: 팔지 않고, 추가 투자금으로 모자란 쪽부터 사요. 세금·수수료가 적게 들어요.',
  ],
  byAccount: '연금저축·IRP처럼 돈을 다른 계좌로 옮기기 어려울 때 켜세요. 같은 목표 비중을 계좌마다 따로 맞추고, 계좌 안에서만 사고팔아요.',
  realized: '올해 이미 팔아서 생긴 해외주식 이익이에요(손실이면 앞에 -). 해외주식은 한 해 이익을 모두 합쳐 250만원을 빼고 세금을 매겨서, 이 값을 넣으면 세금을 더 정확히 추정해요.',
};

// 탭을 오가도 유지되는 계산 옵션 (앱을 닫으면 초기화)
const options = {
  method: 'full',
  byAccount: false,
  additional: null,
  additionalByAccount: {},
  realizedOverseasGain: null,
  calculated: false,
  showAnyway: false,
};

const pct = (ratio) => formatPercent(ratio);
const pointText = (ratio) => `${formatNumber(ratio * 100, { maximumFractionDigits: 1 })}%p`;

function quantityText(quantity) {
  return `${formatNumber(quantity, { maximumFractionDigits: 4 })}주`;
}

// 목표 입력 항목: [키, 이름, 현재 비중]
function targetItems(mode, holdings, rows) {
  if (mode === 'assetClass') {
    const current = new Map(analyzeDiversification(rows).assetClass.map((item) => [item.name, item.weight]));
    return ASSET_CLASSES.map((name) => [name, name, current.get(name) ?? 0]);
  }
  const weights = new Map(holdingWeights(rows).map((item) => [item.ticker, item.weight]));
  const names = new Map(holdings.map((holding) => [holding.ticker, holding.name]));
  return targetKeys('ticker', holdings)
    .map((ticker) => [ticker, names.get(ticker), weights.get(ticker) ?? 0])
    .sort((a, b) => b[2] - a[2]);
}

// 현재 비중으로 목표를 채운다. 소수 첫째 자리로 반올림하고, 합계가 100이 되게 가장 큰 항목에서 맞춘다.
function currentAsTargets(items) {
  const values = Object.fromEntries(items.map(([key, , weight]) => [key, Math.round(weight * 1000) / 10]));
  const total = Object.values(values).reduce((sum, value) => sum + value, 0);
  const largest = items.reduce((best, item) => (item[2] > best[2] ? item : best), items[0]);
  if (largest && total > 0) values[largest[0]] = Math.round((values[largest[0]] + 100 - total) * 10) / 10;
  return values;
}

// 현재 vs 목표 막대 (목표 위치 표시선 + 허용 범위)
function comparisonList(items, values, band) {
  const shown = items.filter(([key, , current]) => current > 0 || (values[key] ?? 0) > 0);
  if (shown.length === 0) return el('p', { class: 'muted small', text: '목표 비중을 입력하면 지금 비중과 비교해 보여드려요.' });
  return el('ul', { class: 'bullet-list' }, shown.map(([key, name, current]) => {
    const target = (values[key] ?? 0) / 100;
    const outside = Math.abs(current - target) > band / 100;
    const label = `${name}: 현재 ${pct(current)}, 목표 ${pct(target)}${outside ? ', 허용 범위를 벗어남' : ''}`;
    return el('li', { class: 'bullet-row' },
      el('div', { class: 'bullet-head' },
        el('span', { class: 'bullet-name' }, el('span', { text: name }), outside ? el('span', { class: 'badge badge-warn badge-tiny', text: '벗어남' }) : null),
        el('span', { class: 'bullet-values num', text: `현재 ${pct(current)} · 목표 ${pct(target)}` })),
      el('div', { class: 'bullet-track', role: 'img', 'aria-label': label },
        el('span', { class: 'bullet-band', style: `left: ${Math.max(0, target * 100 - band)}%; width: ${Math.min(100, target * 100 + band) - Math.max(0, target * 100 - band)}%` }),
        el('span', { class: 'bullet-fill', style: `width: ${Math.min(100, current * 100)}%` }),
        el('span', { class: 'bullet-target', style: `left: ${Math.min(100, target * 100)}%` })));
  }));
}

function legend(band) {
  return el('p', { class: 'bullet-legend' },
    el('span', { class: 'legend-item' }, el('span', { class: 'legend-fill', 'aria-hidden': 'true' }), '현재 비중'),
    el('span', { class: 'legend-item' }, el('span', { class: 'legend-target', 'aria-hidden': 'true' }), '목표'),
    el('span', { class: 'legend-item' }, el('span', { class: 'legend-band', 'aria-hidden': 'true' }), `허용 범위 ±${band}%p`));
}

function lineAccounts(line) {
  if (line.account || line.accounts.length < 2) return line.accounts[0];
  return `${line.accounts.join('·')}에 나눠 있음`;
}

function groupCard(group, { method, money, band, showAnyway, onShowAnyway }) {
  const title = group.account ? `${group.account} 계좌` : '전체 보유 종목';
  const summary = `지금 ${money(group.current)}${group.additional > 0 ? ` + 추가 투자금 ${money(group.additional)}` : ''}`;
  const card = el('section', { class: 'card result-card' },
    el('div', { class: 'result-head' }, el('h2', { class: 'section-title', text: title }), el('span', { class: 'muted small', text: summary })));

  if (group.missing.length > 0) {
    const names = group.missing.map((item) => `${item.name}(${pct(item.target)})`).join(', ');
    card.append(el('p', { class: 'banner banner-warn' },
      `${names} 목표가 있지만 ${group.account ? '이 계좌에' : '보유 종목에'} 살 종목이 없어서 나머지 자산군 비율로 맞췄어요. `,
      '사려면 보유 종목에 그 자산군 종목을 추가하세요(수량 0으로 추가해도 돼요).'));
  }
  if (group.noTargets) {
    card.append(el('p', { class: 'muted', text: '이 계좌의 종목에는 목표 비중이 없어서 그대로 둬요.' }));
    return card;
  }
  if (method === 'buyOnly' && group.additional <= 0) {
    card.append(el('p', { class: 'muted', text: '이 계좌에는 추가 투자금이 없어서 그대로 둬요.' }));
    return card;
  }
  if (method === 'full' && group.withinBand && group.additional <= 0 && !showAnyway) {
    card.append(
      el('p', { class: 'banner banner-ok' },
        el('strong', { text: '지금은 리밸런싱이 필요 없어요. ' }),
        `모든 비중이 목표 ±${band}%p 안에 있어요 (가장 큰 차이 ${pointText(group.maxDrift)}).`),
      el('button', { type: 'button', class: 'btn btn-small', text: '그래도 정확히 맞추는 방법 보기', onClick: onShowAnyway }));
    return card;
  }

  const order = { sell: 0, buy: 1, hold: 2 };
  const lines = [...group.lines].sort((a, b) => order[a.action] - order[b.action] || Math.abs(b.amount) - Math.abs(a.amount));
  const priceNote = (line) => (line.priceSource === 'avg' ? ' (현재가가 없어 평단가로 계산)' : '');

  const table = el('table', { class: 'table result-table' },
    el('thead', {}, el('tr', {},
      ['종목', '현재 비중', '목표 비중', '매수/매도', '수량', '예상 금액']
        .map((head, index) => el('th', { scope: 'col', class: index > 0 && index !== 3 ? 'num' : null, text: head })))),
    el('tbody', {}, lines.map((line) => el('tr', { class: line.action === 'hold' ? 'is-hold' : null },
      el('td', {}, el('div', { class: 'cell-name', text: line.name }), el('div', { class: 'cell-sub', text: `${line.ticker} · ${lineAccounts(line)}` })),
      el('td', { class: 'num', text: pct(line.currentWeight) }),
      el('td', { class: 'num' }, el('div', { text: pct(line.targetWeight) }), el('div', { class: 'cell-sub', text: `매매 후 ${pct(line.afterWeight)}` })),
      el('td', {}, el('span', { class: `badge ${ACTION_BADGES[line.action]}`, text: ACTION_LABELS[line.action] })),
      el('td', { class: 'num' },
        el('div', { text: line.action === 'hold' ? '–' : quantityText(line.tradeQuantity) }),
        line.action === 'hold' ? null : el('div', { class: 'cell-sub', text: `× ${formatPrice(line.price, line.currency)}${priceNote(line)}` })),
      el('td', { class: 'num', text: line.action === 'hold' ? '–' : money(Math.abs(line.amount)) })))));

  const cards = el('ul', { class: 'result-cards' }, lines.map((line) => el('li', { class: `result-item${line.action === 'hold' ? ' is-hold' : ''}` },
    el('div', { class: 'result-item-head' },
      el('span', { class: 'cell-name', text: line.name }),
      el('span', { class: `badge ${ACTION_BADGES[line.action]}`, text: ACTION_LABELS[line.action] })),
    line.action === 'hold'
      ? null
      : el('p', { class: 'result-item-trade num', text: `${quantityText(line.tradeQuantity)} × ${formatPrice(line.price, line.currency)} = 약 ${money(Math.abs(line.amount))}${priceNote(line)}` }),
    el('p', { class: 'cell-sub', text: `현재 ${pct(line.currentWeight)} → 목표 ${pct(line.targetWeight)} (매매 후 ${pct(line.afterWeight)}) · ${lineAccounts(line)}` }))));

  card.append(el('div', { class: 'table-wrap result-table-wrap' }, table), cards);

  const leftover = el('p', { class: 'leftover' }, `남는 돈: ${money(group.leftover)}`);
  if (group.suggestions.length > 0) {
    const names = group.suggestions.map((item) => `${item.name} ${item.step === 1 ? '1주' : `${item.step}주`}(${money(item.cost)})`).join(', ');
    leftover.append(el('span', { class: 'muted', text: ` — 남은 돈으로 더 살 수 있어요: ${names}` }));
  }
  card.append(leftover);
  return card;
}

function costsCard(costs, { money, hasOverseasSell }) {
  const rows = [
    ['예상 수수료', money(costs.fee), costs.feeOverseas > 0 ? `국내 ${money(costs.feeDomestic)} · 해외 ${money(costs.feeOverseas)}` : null],
    ['국내 주식 매도 거래세', money(costs.domesticTax), null],
  ];
  if (hasOverseasSell) {
    rows.push(['해외주식 매도 차익', money(costs.overseasGain), '지금 환율로 계산'],
      ['예상 양도소득세 (이번 매도분)', costs.overseasTax < 0 ? `-${money(-costs.overseasTax)}` : money(costs.overseasTax),
        costs.overseasTax < 0 ? '손실이라 올해 다른 차익의 세금이 줄어요' : `올해 전체 예상 ${money(costs.overseasYearTax)}`]);
  }
  return el('section', { class: 'card costs-card' },
    el('h2', { class: 'section-title', text: '예상 수수료·세금' }),
    el('dl', { class: 'cost-list' }, rows.map(([label, value, note]) => el('div', { class: 'cost-row' },
      el('dt', {}, el('span', { text: label }), note ? el('span', { class: 'cost-note', text: note }) : null),
      el('dd', { class: 'num', text: value })))),
    el('ul', { class: 'muted small cost-notes' },
      el('li', { text: '추정치이며 실제 세금은 다를 수 있어요.' }),
      el('li', { text: '해외주식 양도소득세는 한 해 차익을 모두 합쳐 250만원을 뺀 뒤 22%로 계산했어요.' }),
      el('li', { text: '국내 상장 ETF는 증권거래세가 없어요. 국내 상장 해외·채권 ETF 등의 매매차익에 붙는 배당소득세(15.4%)는 계산하지 않았어요.' }),
      el('li', { text: '수수료·세금은 매매 금액과 따로 들어요.' })));
}

export function render(root, { getState, updateState, subscribe }) {
  let lastKey = '';

  function draw() {
    clear(root);
    const state = getState();
    lastKey = JSON.stringify([state.holdings, state.settings]);
    const { settings } = state;
    const band = settings.rebalanceBand;
    const money = (value) => formatMoney(value, { unit: settings.displayUnit });
    const market = getMarket(state);
    const portfolio = valuePortfolio(state.holdings, { prices: market.prices, fxRate: market.fx.rate });

    root.append(el('p', { class: 'page-lead' }, '목표 비중을 정하면 무엇을 몇 주 사고팔지 계산해 드려요. ', helpTip('리밸런싱', HELP.rebalance)));

    if (state.holdings.length === 0) {
      root.append(el('section', { class: 'card empty-state' },
        el('p', { class: 'empty-title', text: '리밸런싱할 종목이 없어요' }),
        el('p', { class: 'muted', text: '보유 종목을 입력하면 목표 비중에 맞추는 방법을 계산해 드려요. 공제회·예적금·연금은 사고팔 수 없어서 리밸런싱에 넣지 않아요.' }),
        el('a', { class: 'btn btn-primary', href: '#holdings', text: '보유 종목으로 가기' })));
      return;
    }

    // ── 목표 비중 ──
    const mode = state.targets.mode;
    const items = targetItems(mode, state.holdings, portfolio.rows);
    const draft = { ...(mode === 'assetClass' ? state.targets.assetClass : state.targets.ticker) };
    const sumNode = el('p', { class: 'mix-sum', 'aria-live': 'polite' });
    const comparison = el('div', { class: 'comparison' });
    const calcButton = el('button', { type: 'button', class: 'btn btn-primary', text: '계산하기' });
    const calcNote = el('p', { class: 'field-error calc-note', hidden: true });
    const results = el('div', { class: 'results', 'aria-live': 'polite' });

    // 계산한 뒤 조건이 바뀌면 예전 결과를 흐리게 하고 다시 계산하도록 안내한다.
    // 결과를 바로 지우면 화면이 밀려서, 금액을 입력하고 누른 '계산하기'가 빗나갈 수 있다.
    const markStale = () => {
      if (!options.calculated) return;
      options.calculated = false;
      results.classList.add('is-stale');
      results.append(el('p', { class: 'stale-note', role: 'status', text: '조건이 바뀌었어요. 계산하기를 다시 눌러 주세요.' }));
    };

    const draftSum = () => items.reduce((total, [key]) => total + (draft[key] > 0 ? draft[key] : 0), 0);
    const refreshDraft = () => {
      const total = Math.round(draftSum() * 100) / 100;
      const complete = Math.abs(total - 100) < 0.01;
      sumNode.classList.toggle('is-warn', !complete);
      sumNode.textContent = complete ? '합계 100%' : `합계 ${formatNumber(total, { maximumFractionDigits: 2 })}% · 100%가 되도록 맞춰 주세요`;
      calcButton.disabled = !complete;
      calcNote.hidden = complete;
      calcNote.textContent = complete ? '' : `목표 비중 합계가 100%가 되어야 계산할 수 있어요. (지금 ${formatNumber(total, { maximumFractionDigits: 2 })}%)`;
      clear(comparison);
      comparison.append(comparisonList(items, draft, band));
    };

    const saveTargets = (values) => {
      updateState((next) => {
        next.targets[mode] = Object.fromEntries(Object.entries(values).filter(([, value]) => value > 0));
      });
    };

    const modeControl = segmented({
      options: MODE_OPTIONS,
      value: mode,
      onChange: (value) => {
        updateState((next) => { next.targets.mode = value; });
        options.calculated = false;
        draw();
        root.querySelector('.targets-card .segmented input:checked')?.focus();
      },
    });
    modeControl.element.setAttribute('aria-label', '목표 비중을 정하는 단위');

    const targetRows = el('div', { class: 'target-rows' }, items.map(([key, name, current]) => {
      const input = textInput({ value: draft[key] > 0 ? String(draft[key]) : '', inputmode: 'decimal', placeholder: '0' });
      const field = createField({
        label: name,
        control: input,
        suffix: '%',
        hint: `지금 ${pct(current)}${mode === 'ticker' ? ` · ${key}` : ''}`,
        className: 'target-field',
      });
      const read = () => {
        const value = parseNumberInput(input.value);
        if (value === null) return { ok: true, value: 0 };
        if (!Number.isFinite(value) || value < 0 || value > 100) return { ok: false };
        return { ok: true, value };
      };
      input.addEventListener('input', () => {
        const result = read();
        draft[key] = result.ok ? result.value : 0;
        refreshDraft();
        markStale();
      });
      input.addEventListener('change', () => {
        const result = read();
        field.setError(result.ok ? null : '0 ~ 100 사이 숫자로 입력해 주세요.');
        if (!result.ok) return;
        draft[key] = result.value;
        saveTargets(draft);
      });
      return field.element;
    }));

    const fillButton = el('button', { type: 'button', class: 'btn btn-small', text: '지금 비중으로 채우기' });
    fillButton.addEventListener('click', () => {
      saveTargets(currentAsTargets(items));
      draw();
    });

    root.append(el('section', { class: 'card targets-card' },
      el('h2', { class: 'section-title', text: '목표 비중' }),
      modeControl.element,
      el('p', { class: 'section-desc', text: mode === 'assetClass'
        ? '자산군마다 목표를 정해요. 자산군 안의 종목들은 지금 비율대로 나눠요.'
        : '종목마다 목표를 정해요. 목표를 비워 두거나 0%로 두면 그 종목은 모두 팔아요. 새로 살 종목은 보유 종목에 수량 0으로 추가하세요.' }),
      targetRows,
      el('div', { class: 'mix-foot' }, fillButton, sumNode)));

    root.append(el('section', { class: 'card' },
      el('h2', { class: 'section-title', text: '지금 비중 vs 목표' }),
      legend(band),
      comparison));

    // ── 계산 방법 ──
    const accounts = ACCOUNTS.filter((account) => state.holdings.some((holding) => holding.account === account));
    const methodControl = segmented({
      options: METHOD_OPTIONS,
      value: options.method,
      onChange: (value) => {
        options.method = value;
        drawAdditional();
        markStale();
      },
    });
    methodControl.element.setAttribute('aria-label', '계산 방법');

    const byAccountInput = el('input', { type: 'checkbox', class: 'check-input', checked: options.byAccount, id: uid('by-account') });
    byAccountInput.addEventListener('change', () => {
      options.byAccount = byAccountInput.checked;
      drawAdditional();
      markStale();
    });

    const additionalBox = el('div', { class: 'additional-box' });
    const moneyField = (label, value, onChange) => {
      const input = numberInput({ value: value == null ? '' : String(value), placeholder: '0' });
      const field = createField({ label, control: input, suffix: '원' });
      input.addEventListener('change', () => {
        const parsed = parseNumberInput(input.value);
        const valid = parsed === null || (Number.isFinite(parsed) && parsed >= 0);
        field.setError(valid ? null : '0 이상의 숫자로 입력해 주세요.');
        if (!valid) return;
        onChange(parsed);
        markStale();
      });
      return field.element;
    };
    function drawAdditional() {
      clear(additionalBox);
      const label = options.method === 'buyOnly' ? '추가 투자금 (필수)' : '추가 투자금 (선택)';
      if (options.byAccount) {
        additionalBox.append(el('p', { class: 'field-label', text: `${label} — 계좌별로 입력` }),
          el('div', { class: 'form-pair' }, accounts.map((account) => moneyField(account, options.additionalByAccount[account], (value) => {
            options.additionalByAccount[account] = value;
          }))));
      } else {
        additionalBox.append(moneyField(label, options.additional, (value) => { options.additional = value; }));
      }
    }
    drawAdditional();

    const realizedInput = textInput({
      value: options.realizedOverseasGain == null ? '' : formatNumber(options.realizedOverseasGain), inputmode: null, placeholder: '0',
    });
    const realizedField = createField({
      label: '올해 이미 실현한 해외주식 차익 (선택)', control: realizedInput, suffix: '원', help: HELP.realized,
    });
    realizedInput.addEventListener('change', () => {
      const parsed = parseNumberInput(realizedInput.value);
      const valid = parsed === null || Number.isFinite(parsed);
      realizedField.setError(valid ? null : '숫자로 입력해 주세요. 손실이면 앞에 -를 붙여요.');
      if (!valid) return;
      options.realizedOverseasGain = parsed;
      if (parsed !== null) realizedInput.value = formatNumber(parsed);
      markStale();
    });

    root.append(el('section', { class: 'card method-card' },
      el('div', { class: 'score-head' }, el('h2', { class: 'section-title', text: '계산 방법' }), helpTip('계산 방법', HELP.method)),
      el('div', { class: 'form' },
        methodControl.element,
        el('div', { class: 'check-row-wrap' },
          el('label', { class: 'check-row', for: byAccountInput.id }, byAccountInput, el('span', { text: '계좌별로 나누어 계산' })),
          helpTip('계좌별로 나누어 계산', HELP.byAccount)),
        additionalBox,
        realizedField.element,
        el('div', {}, calcButton, calcNote))));
    root.append(results);

    function showResults() {
      clear(results);
      results.classList.remove('is-stale');
      const current = getState();
      const result = rebalance({
        rows: portfolio.rows,
        fxRate: market.fx.rate,
        targets: current.targets,
        method: options.method,
        additional: options.additional ?? 0,
        additionalByAccount: options.additionalByAccount,
        byAccount: options.byAccount,
        allowFractionalUS: settings.allowFractionalUS,
        band,
      });
      if (!result.ok) {
        const messages = {
          'target-sum': '목표 비중 합계가 100%가 되어야 계산할 수 있어요.',
          'no-holdings': '현재가나 환율이 있는 종목이 없어서 계산할 수 없어요.',
          'no-additional': '매수만으로 맞추려면 추가 투자금을 입력해 주세요.',
        };
        results.append(el('p', { class: 'banner banner-warn', role: 'alert', text: messages[result.error] }));
        return;
      }
      for (const item of result.excluded) {
        results.append(el('p', { class: 'banner banner-warn', text: `${item.name}: ${item.reason}` }));
      }
      for (const group of result.groups) {
        results.append(groupCard(group, {
          method: options.method,
          money,
          band,
          showAnyway: options.showAnyway,
          onShowAnyway: () => {
            options.showAnyway = true;
            showResults();
          },
        }));
      }
      const lines = result.groups.flatMap((group) => group.lines);
      if (lines.some((line) => line.action !== 'hold')) {
        const costs = estimateCosts(lines, settings, { realizedOverseasGain: options.realizedOverseasGain ?? 0 });
        results.append(costsCard(costs, { money, hasOverseasSell: costs.overseasSells > 0 }));
      }
    }

    calcButton.addEventListener('click', () => {
      // 입력 중인 금액 칸의 값을 먼저 반영한다 (라디오·체크박스는 이미 반영돼 있다)
      root.querySelectorAll('.method-card input[type="text"]').forEach((input) => input.dispatchEvent(new Event('change')));
      options.calculated = true;
      options.showAnyway = false;
      showResults();
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    refreshDraft();
    if (options.calculated && !calcButton.disabled) showResults();
  }

  draw();
  const unsubscribeState = subscribe((state) => {
    // 목표 비중을 입력할 때마다 화면을 다시 그리면 입력 칸 초점이 사라지므로, 종목·설정이 바뀔 때만 다시 그린다.
    if (JSON.stringify([state.holdings, state.settings]) !== lastKey) draw();
  });
  const unsubscribeMarket = subscribeMarket(draw);
  return () => {
    unsubscribeState();
    unsubscribeMarket();
  };
}
