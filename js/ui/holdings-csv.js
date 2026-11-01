// CSV 붙여넣기로 보유 종목 한 번에 등록하는 창

import { ACCOUNTS, ASSET_CLASSES } from '../constants.js';
import { HOLDING_CSV_COLUMNS, HOLDING_CSV_TEMPLATE, parseHoldingsCsv } from '../calc/csv.js';
import { COUNTRY_PRESETS } from '../country-weights.js';
import { el, clear, openModal, showToast, uid } from '../dom.js';

const COLUMN_HINTS = {
  name: '예: 삼성전자',
  ticker: '구글 시트와 같은 형식. 예: KRX:005930, NASDAQ:QQQ',
  quantity: '보유 수량',
  avgPrice: '평균 매입 단가 (그 종목의 통화 기준)',
  type: '주식 또는 ETF (비우면 주식)',
  etfSpread: 'ETF만: 시장 전체형 / 업종·테마형 / 집중형 (비우면 종목명으로 짐작)',
  currency: 'KRW 또는 USD (비우면 티커로 짐작)',
  account: `${ACCOUNTS.join(' / ')} (비우면 일반)`,
  assetClass: `${ASSET_CLASSES.join(' / ')} (비우면 기타)`,
  country: `투자 대상 나라. 예: 미국. ETF는 미국:60;한국:40 처럼 나누거나 ${COUNTRY_PRESETS.join('·')} 같은 비중표 이름 (비우면 종목명으로 짐작)`,
  sector: '예: 기술. ETF는 기술:50;통신:15;소비재:35 처럼 나눠 적기 (비우면 기타)',
  manualPrice: '직접 입력할 현재가',
  dividendPerShare: '연간 주당 배당금',
  memo: '메모',
};

const STATUS = {
  add: { label: '추가', badge: 'badge-ok' },
  update: { label: '덮어쓰기', badge: 'badge-info' },
  skip: { label: '건너뜀', badge: '' },
  error: { label: '오류', badge: 'badge-danger' },
};
const PREVIEW_LIMIT = 100;

function debounce(fn, wait) {
  let timer = null;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, wait);
  };
}

export function openCsvImport({ getState, updateState }) {
  let result = null;

  const textarea = el('textarea', {
    class: 'input textarea csv-input', id: uid('csv'), rows: '8', spellcheck: 'false', placeholder: HOLDING_CSV_TEMPLATE,
  });
  const overwrite = el('input', { type: 'checkbox', class: 'check-input' });
  const preview = el('div', { class: 'csv-preview', 'aria-live': 'polite' });
  const cancelButton = el('button', { type: 'button', class: 'btn', text: '취소' });
  const submitButton = el('button', { type: 'button', class: 'btn btn-primary', text: '등록', disabled: true });

  function drawPreview() {
    clear(preview);
    submitButton.disabled = true;
    submitButton.textContent = '등록';
    if (!result) return;
    if (result.error) {
      preview.append(el('p', { class: 'banner banner-danger', text: result.error }));
      return;
    }

    const counts = { add: 0, update: 0, skip: 0, error: 0 };
    result.rows.forEach((row) => { counts[row.status] += 1; });
    const importable = counts.add + counts.update;
    preview.append(el('p', { class: 'csv-counts' },
      Object.keys(STATUS).filter((status) => counts[status] > 0)
        .map((status) => el('span', { class: `badge ${STATUS[status].badge}`, text: `${STATUS[status].label} ${counts[status]}` }))));
    if (counts.error > 0 && importable > 0) {
      preview.append(el('p', { class: 'muted small', text: '오류가 있는 줄은 빼고 등록돼요. 고친 뒤 다시 붙여넣어도 괜찮아요.' }));
    }

    preview.append(el('ul', { class: 'csv-rows' }, result.rows.slice(0, PREVIEW_LIMIT).map((row) => el('li', { class: 'csv-row' },
      el('div', { class: 'csv-row-head' },
        el('span', { class: 'csv-line', text: `${row.line}줄` }),
        el('span', { class: 'csv-name', text: row.name || row.ticker || '(이름 없음)' }),
        el('span', { class: `badge ${STATUS[row.status].badge}`, text: STATUS[row.status].label })),
      row.messages.length > 0
        ? el('ul', { class: `csv-messages${row.status === 'error' ? ' is-error' : ''}` }, row.messages.map((message) => el('li', { text: message })))
        : null))));
    if (result.rows.length > PREVIEW_LIMIT) {
      preview.append(el('p', { class: 'muted small', text: `…외 ${result.rows.length - PREVIEW_LIMIT}줄` }));
    }

    submitButton.disabled = importable === 0;
    if (importable > 0) submitButton.textContent = `${importable}개 등록`;
  }

  function check() {
    const state = getState();
    result = textarea.value.trim() === ''
      ? null
      : parseHoldingsCsv(textarea.value, {
        existing: state.holdings,
        allowFractionalUS: state.settings.allowFractionalUS,
        overwrite: overwrite.checked,
      });
    drawPreview();
  }

  textarea.addEventListener('input', debounce(check, 250));
  overwrite.addEventListener('change', check);

  const exampleButton = el('button', { type: 'button', class: 'btn-link', text: '예시 넣기' });
  exampleButton.addEventListener('click', () => {
    textarea.value = HOLDING_CSV_TEMPLATE;
    check();
  });

  const body = el('div', { class: 'form' },
    el('p', { class: 'section-desc', text: '엑셀이나 구글 시트에서 표를 복사해 붙여넣거나, 쉼표(,)로 구분해 적어 주세요. 첫 줄은 제목 줄이에요.' }),
    el('details', { class: 'csv-help' },
      el('summary', { text: '열 설명 보기' }),
      el('ul', {}, HOLDING_CSV_COLUMNS.map((column) => el('li', {},
        el('strong', { text: column.label }),
        column.required ? el('span', { class: 'badge badge-tiny', text: '필수' }) : null,
        ` ${COLUMN_HINTS[column.key]}`)))),
    el('div', { class: 'field' },
      el('div', { class: 'field-label-row' }, el('label', { class: 'field-label', for: textarea.id, text: '붙여넣기' }), exampleButton),
      textarea),
    el('label', { class: 'check-row' }, overwrite, el('span', { text: '같은 계좌에 이미 있는 종목은 새 값으로 덮어쓰기' })),
    preview);

  const { close } = openModal({ title: 'CSV로 한 번에 등록', body, footer: [cancelButton, submitButton] });
  cancelButton.addEventListener('click', close);

  submitButton.addEventListener('click', () => {
    const rows = result?.rows?.filter((row) => row.status === 'add' || row.status === 'update') ?? [];
    if (rows.length === 0) return;
    updateState((draft) => {
      for (const { holding } of rows) {
        const index = draft.holdings.findIndex((item) => item.id === holding.id);
        if (index >= 0) draft.holdings[index] = holding;
        else draft.holdings.push(holding);
      }
    });
    close();
    showToast(`${rows.length}개 종목을 등록했어요`);
  });
}
