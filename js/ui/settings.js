// 설정 탭: 항목을 바꾸면 검증 후 바로 저장한다.

import { SETTINGS_SCHEMA } from '../constants.js';
import { coerceValue } from '../validate.js';
import { testConnection } from '../market.js';
import { el, helpTip, showToast } from '../dom.js';
import { formatNumber } from '../format.js';
import { createField, createToggleField, selectInput, textInput } from './form.js';
import { dataSection, installSection } from './data-tools.js';

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => [i + 1, `${i + 1}월`]);

function retirementAgeHint({ birthYear, birthMonth, retirementDate }) {
  if (!birthYear || !retirementDate) return '출생연도도 입력하면 퇴직할 때 나이를 알려드려요.';
  const [year, month] = retirementDate.split('-').map(Number);
  const age = year - birthYear - (month < birthMonth ? 1 : 0);
  if (age < 0) return '출생연도보다 이른 시점이에요. 다시 확인해 주세요.';
  return `퇴직할 때 만 ${age}세예요.`;
}

const SECTIONS = [
  {
    title: '화면',
    fields: [
      {
        key: 'theme', label: '화면 모드', kind: 'select',
        options: [['system', '시스템 설정 따름'], ['light', '라이트'], ['dark', '다크']],
      },
      {
        key: 'displayUnit', label: '금액 표시 단위', kind: 'select',
        options: [['auto', '자동 (만원·억원)'], ['won', '원 단위'], ['man', '만원 단위']],
        help: '자동은 1만원이 넘으면 "2,346만원", 1억원이 넘으면 "1억 2,346만원"처럼 보여줘요.',
      },
      {
        key: 'invertPnlColors', label: '손익 색상', kind: 'select',
        options: [[false, '수익 빨강 · 손실 파랑 (한국식)'], [true, '수익 파랑 · 손실 빨강']],
      },
    ],
  },
  {
    title: '시세 연결',
    description: '구글 시트를 연결하면 현재가와 환율을 자동으로 받아와요. 연결하기 전에는 직접 입력한 가격으로 계산해요.',
    fields: [
      {
        key: 'sheetUrl', label: '내 구글 시트 웹 앱 주소', kind: 'text', inputType: 'url',
        placeholder: 'https://script.google.com/macros/s/…/exec',
        hint: '아직 없다면 비워 두세요. 비우면 직접 입력한 가격으로 계산해요.',
        help: '구글 시트에 붙인 Apps Script를 "웹 앱"으로 배포하면 생기는 주소예요. 시트에는 종목 코드만 적고 수량·금액은 적지 않아요.',
        extra: 'connection',
      },
      {
        key: 'manualFxUsdKrw', label: '달러 환율 (직접 입력)', kind: 'number', suffix: '원', placeholder: '예: 1380',
        help: '1달러가 몇 원인지예요. 구글 시트에서 환율을 받아오지 못할 때 이 값으로 미국 주식을 원화로 바꿔 계산해요.',
      },
    ],
  },
  {
    title: '내 정보',
    description: '사람마다 다르니 직접 입력해 주세요. 미래 예측과 연금 계산에 써요.',
    fields: [
      { key: 'birthYear', label: '출생연도', kind: 'number', integer: true, suffix: '년', placeholder: '예: 1980' },
      {
        key: 'birthMonth', label: '출생월', kind: 'select', options: MONTH_OPTIONS,
        hint: '연금을 받기 시작하는 달을 계산할 때 써요.',
      },
      { key: 'retirementDate', label: '퇴직(목표) 시점', kind: 'month', dynamicHint: retirementAgeHint },
      {
        key: 'lifeExpectancy', label: '기대 수명', kind: 'number', integer: true, suffix: '세',
        help: '평생 받는 연금(종신)을 계산할 때 이 나이까지 받는다고 가정해요.',
      },
      {
        key: 'monthlyLivingCost', label: '퇴직 후 월 목표 생활비', kind: 'number', money: true, suffix: '원', placeholder: '예: 3,000,000',
        help: '퇴직 후 한 달에 필요한 생활비예요. 연금이 나오기 전 "소득 공백기"를 몇 년 버틸 수 있는지 계산할 때 써요.',
      },
      {
        key: 'pensionTaxRate', label: '연금 세율 기본값', kind: 'number', suffix: '%',
        help: '연금을 새로 추가할 때 처음 들어가는 세율이에요. 연금마다 기타 자산에서 따로 바꿀 수 있고, 여기서 바꿔도 이미 넣은 연금의 세율은 그대로예요.',
      },
    ],
  },
  {
    title: '미래 예측 가정',
    fields: [
      {
        key: 'inflationRate', label: '물가상승률', kind: 'number', suffix: '%',
        help: '물가는 해마다 조금씩 올라서, 20년 뒤 1억원으로는 지금보다 살 수 있는 게 적어요. 미래 금액을 "지금 돈 가치(현재가치)"로 바꿀 때 이 비율을 써요.',
      },
      {
        kind: 'group', label: '주식 기대 수익률 (연)',
        help: '주식이 1년에 평균 몇 % 오를지에 대한 가정이에요. 미래는 알 수 없으니 낮음·기준·높음 세 가지로 그려봐요.',
        fields: [
          { key: 'stockReturnLow', label: '낮음', kind: 'number', suffix: '%' },
          { key: 'stockReturnBase', label: '기준', kind: 'number', suffix: '%' },
          { key: 'stockReturnHigh', label: '높음', kind: 'number', suffix: '%' },
        ],
      },
      {
        key: 'stockMonthlyInvestment', label: '주식 월 추가 투자액', kind: 'number', money: true, suffix: '원',
        help: '앞으로 매달 주식에 더 넣을 금액이에요. 퇴직 시점의 예상 자산을 계산할 때 써요.',
      },
    ],
  },
  {
    title: '쏠림 경고 기준',
    description: '한 곳에 너무 많이 몰려 있으면 경고를 보여줘요. 숫자를 낮출수록 더 엄격해져요.',
    fields: [
      {
        key: 'warnSector', label: '한 섹터 최대 비중', kind: 'number', suffix: '%',
        help: '섹터는 기술·금융·소비재처럼 회사가 하는 일의 분야예요.',
      },
      { key: 'warnCountry', label: '한 국가 최대 비중', kind: 'number', suffix: '%' },
      { key: 'warnSingle', label: '한 종목 최대 비중', kind: 'number', suffix: '%' },
    ],
  },
  {
    title: '리밸런싱 · 매매',
    fields: [
      {
        key: 'rebalanceBand', label: '리밸런싱 허용 오차', kind: 'number', suffix: '%p',
        help: '리밸런싱은 비중이 목표에서 벗어났을 때 사고팔아 다시 맞추는 거예요. 차이가 이 값보다 작으면 "지금은 안 해도 돼요"라고 알려줘요. 예: 목표 30%, 허용 오차 5%p면 25~35%는 괜찮아요.',
      },
      {
        key: 'feeRateDomestic', label: '매매 수수료율 (국내)', kind: 'number', suffix: '%',
        help: '증권사에 내는 매매 수수료 비율이에요. 증권사 앱에서 확인할 수 있어요.',
      },
      { key: 'feeRateOverseas', label: '매매 수수료율 (해외)', kind: 'number', suffix: '%' },
      {
        key: 'domesticSellTaxRate', label: '국내 주식 매도 거래세율', kind: 'number', suffix: '%',
        help: '국내 주식을 팔 때 붙는 세금(증권거래세 등)이에요. 제도가 바뀌면 여기서 고쳐 주세요.',
      },
      {
        key: 'allowFractionalUS', label: '미국 주식 소수점 매매', kind: 'toggle',
        hint: '켜면 미국 주식 수량을 0.5주처럼 소수점으로 입력할 수 있고, 리밸런싱도 소수점 단위로 계산해요.',
      },
    ],
  },
];

// 연결 테스트 결과 문구. 환율이 없거나, 가격을 못 받았거나, 시트에 없는 종목이 있으면 경고로 보여준다.
function connectionReport(data, holdings) {
  const count = Object.keys(data.prices).length;
  const lines = [`연결됐어요! 시세 ${count}개를 받았어요.`];
  let tone = 'ok';
  if (data.fx.USDKRW) {
    lines.push(`달러 환율: ${formatNumber(data.fx.USDKRW, { maximumFractionDigits: 2 })}원`);
  } else {
    tone = 'warn';
    lines.push('달러 환율을 받지 못했어요. 시트 A열에 CURRENCY:USDKRW 줄을 추가해 주세요.');
  }
  if (data.errors.length > 0) {
    tone = 'warn';
    lines.push(`가격을 받지 못한 티커 ${data.errors.length}개: ${data.errors.slice(0, 5).join(', ')} — 티커 형식을 확인해 주세요.`);
  }
  const missing = [...new Set(holdings.map((h) => h.ticker))]
    .filter((ticker) => !Object.hasOwn(data.prices, ticker) && !data.errors.includes(ticker));
  if (missing.length > 0) {
    tone = 'warn';
    lines.push(`시트에 없는 티커 ${missing.length}개: ${missing.slice(0, 5).join(', ')} — 시트 A열에 추가해 주세요.`);
  }
  return { tone, lines };
}

function displayValue(field, value) {
  if (value == null) return '';
  if (field.money) return formatNumber(value);
  return String(value);
}

function inputMode(field) {
  const spec = SETTINGS_SCHEMA[field.key];
  // iOS 숫자 키패드에는 마이너스 키가 없어서, 음수를 허용하는 칸은 일반 키보드를 쓴다.
  if (spec.min != null && spec.min < 0) return null;
  return field.integer || field.money ? 'numeric' : 'decimal';
}

function createControl(field, value) {
  switch (field.kind) {
    case 'select':
      return selectInput(field.options, String(value));
    case 'month':
      return el('input', { type: 'month', class: 'input', placeholder: '2044-06', value: value ?? '' });
    case 'text': {
      const input = textInput({ type: field.inputType ?? 'text', placeholder: field.placeholder, value: value ?? '' });
      input.spellcheck = false;
      return input;
    }
    default:
      return textInput({ inputmode: inputMode(field), placeholder: field.placeholder, value: displayValue(field, value) });
  }
}

export function render(root, { getState, updateState, navigate }) {
  const hintUpdaters = [];
  const refreshHints = () => {
    const { settings } = getState();
    hintUpdaters.forEach((update) => update(settings));
  };

  // 검증을 통과하면 바로 저장한다. view가 없으면(스위치) 오류 표시를 하지 않는다.
  function commit(field, rawValue, view) {
    const result = coerceValue(SETTINGS_SCHEMA[field.key], rawValue);
    if (!result.ok) {
      view?.setError(result.error);
      return;
    }
    view?.setError(null);
    if (field.kind === 'number') view.control.value = displayValue(field, result.value);
    if (Object.is(getState().settings[field.key], result.value)) return;
    updateState((draft) => { draft.settings[field.key] = result.value; });
    refreshHints();
    showToast('저장했어요');
  }

  // 시트 주소 아래: [연결 테스트] [연결 가이드 보기] + 결과
  function connectionTools(control) {
    const result = el('div', { class: 'connection-result', role: 'status', hidden: true });
    const show = (tone, lines) => {
      result.className = `connection-result banner banner-${tone}`;
      result.replaceChildren(...lines.map((line) => el('p', { text: line })));
      result.hidden = false;
    };
    const testButton = el('button', { type: 'button', class: 'btn btn-small', text: '연결 테스트' });
    testButton.addEventListener('click', async () => {
      const check = coerceValue(SETTINGS_SCHEMA.sheetUrl, control.value);
      if (!check.ok || !check.value) {
        show(check.ok ? 'warn' : 'danger', [check.ok ? '먼저 시트 웹 앱 주소를 붙여넣어 주세요.' : check.error]);
        return;
      }
      testButton.disabled = true;
      show('info', ['시트에 연결하는 중…']);
      try {
        const data = await testConnection(check.value, getState().settings.sheetUrl);
        const report = connectionReport(data, getState().holdings);
        show(report.tone, report.lines);
      } catch (error) {
        show('danger', [error.message]);
      } finally {
        testButton.disabled = false;
      }
    });
    return el('div', { class: 'connection-tools' },
      el('div', { class: 'toolbar' }, testButton, el('a', { class: 'btn btn-small', href: '#guide', text: '연결 가이드 보기' })),
      result);
  }

  function renderField(field, { compact = false } = {}) {
    const value = getState().settings[field.key];
    if (field.kind === 'toggle') {
      const { element, control } = createToggleField({ label: field.label, help: field.help, hint: field.hint, checked: value });
      control.addEventListener('change', () => commit(field, control.checked, null));
      return element;
    }
    const control = createControl(field, value);
    const view = createField({ label: field.label, help: field.help, hint: field.hint, control, suffix: field.suffix, compact });
    if (field.dynamicHint) hintUpdaters.push((settings) => view.setHint(field.dynamicHint(settings)));
    if (field.extra === 'connection') view.element.append(connectionTools(control));
    control.addEventListener('change', () => commit(field, control.value, view));
    return view.element;
  }

  function renderGroup(group) {
    return el('fieldset', { class: 'field field-group' },
      el('legend', { class: 'field-legend' },
        el('span', { class: 'field-label', text: group.label }),
        group.help ? helpTip(group.label, group.help) : null),
      el('div', { class: 'field-group-row' }, group.fields.map((field) => renderField(field, { compact: true }))));
  }

  root.append(el('p', { class: 'page-lead', text: '바꾼 내용은 바로 저장돼요.' }));

  for (const section of SECTIONS) {
    root.append(
      el('section', { class: 'card settings-section' },
        el('h2', { class: 'section-title', text: section.title }),
        section.description ? el('p', { class: 'section-desc', text: section.description }) : null,
        section.fields.map((field) => (field.kind === 'group' ? renderGroup(field) : renderField(field)))),
    );
  }

  const install = installSection();
  root.append(dataSection({ getState, updateState, navigate }), install.element);

  refreshHints();
  return install.cleanup;
}
