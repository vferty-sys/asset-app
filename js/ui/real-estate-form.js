// 부동산(집 등) 추가·수정 창.
//  아파트는 "실거래가 평균으로 자동 계산"을 켜면 시·도 → 시·군·구 → 단지 → 전용면적을 골라
//  최근 3개월(없으면 6·12개월) 실거래가 평균을 시트 코드에서 받아온다. 1년 동안 거래가 없으면 직접 적은 시세를 쓴다.
//  그 밖의 부동산은 시세를 직접 적고 1년에 한두 번 고친다.

import { REAL_ESTATE_KINDS } from '../constants.js';
import { todayString } from '../dates.js';
import { realEstateToInput, validateRealEstate } from '../real-estate.js';
import { APT_ERROR_MESSAGES, aptLabel, areaText, fetchAptComplexes, fetchAptPrice, loadDistricts } from '../apt-price.js';
import { getMarket } from '../market.js';
import { el, clear, confirmDialog, openModal, showToast, uid } from '../dom.js';
import { formatDate, formatMoney } from '../format.js';
import { createField, createToggleField, dateInput, numberInput, selectInput, textInput } from './form.js';

const VALUE_HELP = [
  '지금 팔면 받을 수 있을 만한 가격이에요. 같은 단지·같은 평형의 최근 실거래가나 부동산 앱 시세를 참고해 적어 주세요.',
  '층·동에 따라 차이가 있으니 대략이면 돼요. 1년에 한두 번 고쳐 주세요.',
];
const AUTO_HELP = [
  '국토교통부 아파트 매매 실거래가로 같은 단지·같은 전용면적의 최근 3개월 거래 평균을 써요. 3개월 동안 거래가 없으면 6개월, 12개월로 넓혀요.',
  '계약했다가 해제(취소)된 거래는 빼요. 일주일에 한 번 새로 받아와요.',
  '평형은 흔히 부르는 공급면적 기준 어림값이에요(전용 84㎡ ≈ 34평형). 단지마다 1평쯤 다를 수 있어요.',
];

// 두 단지·전용면적이 같은지 (지금 보여 주는 실거래가가 고른 것과 맞는지 확인용)
const sameTarget = (a, b) => Boolean(a && b) && a.lawd === b.lawd && (a.apt ?? '') === (b.apt ?? '') && a.name === b.name
  && (a.dong ?? '') === (b.dong ?? '') && Math.abs(Number(a.area) - Number(b.area)) < 0.005;

const money = (value) => formatMoney(value);

export function openRealEstateForm({ item = null, getState, updateState }) {
  const isEdit = Boolean(item);
  const input = isEdit ? realEstateToInput(item) : { id: '', name: '', kind: '아파트', value: '', baseDate: todayString(), memo: '', auto: null, market: null };
  const sheetUrl = getState().settings.sheetUrl;
  const sheet = getMarket(getState());
  // 실거래가를 받을 수 있는지: 시트 연결 + 최신 시트 코드 + 인증키
  const aptReady = Boolean(sheetUrl) && sheet.aptTrades && sheet.aptKey;
  let auto = input.auto ? { ...input.auto } : null;
  let market = input.market ?? null;

  const nameField = createField({ label: '이름', control: textInput({ value: input.name, placeholder: '예: 우리 집, OO아파트 101동', maxlength: 40 }) });
  const kindField = createField({ label: '종류', control: selectInput(REAL_ESTATE_KINDS, input.kind) });
  const valueField = createField({ label: '시세', help: VALUE_HELP, control: numberInput({ value: input.value, placeholder: '0' }), suffix: '원' });
  const baseDateField = createField({ label: '기준일', hint: '시세를 확인한 날이에요.', control: dateInput({ value: input.baseDate }) });
  const memoField = createField({ label: '메모 (선택)', control: el('textarea', { class: 'input textarea', rows: '2', maxlength: '200', value: input.memo }) });

  // ── 실거래가 자동 계산 (아파트) ──
  const autoToggle = createToggleField({ label: '실거래가 평균으로 자동 계산', help: AUTO_HELP, checked: Boolean(auto) || (!isEdit && aptReady) });
  const sidoSelect = selectInput([], '', { placeholder: '시·도' });
  sidoSelect.setAttribute('aria-label', '시·도');
  const districtSelect = selectInput([], '', { placeholder: '시·군·구' });
  districtSelect.setAttribute('aria-label', '시·군·구');
  const findButton = el('button', { type: 'button', class: 'btn btn-small', text: '단지 찾기' });
  const complexFilter = textInput({ placeholder: '단지 이름으로 좁히기' });
  complexFilter.setAttribute('aria-label', '단지 이름으로 좁히기');
  const complexSelect = selectInput([], '', { placeholder: '단지를 골라 주세요' });
  complexSelect.setAttribute('aria-label', '단지');
  const areaSelect = selectInput([], '', { placeholder: '전용면적' });
  areaSelect.setAttribute('aria-label', '전용면적');
  const priceButton = el('button', { type: 'button', class: 'btn btn-small btn-primary', text: '실거래가 받아오기' });
  const status = el('p', { class: 'apt-status small', role: 'status', hidden: true });
  const current = el('p', { class: 'apt-current small', hidden: true });
  const result = el('div', { class: 'apt-result', 'aria-live': 'polite', hidden: true });
  const autoError = el('p', { class: 'field-error', role: 'alert', hidden: true });
  const pickers = el('div', { class: 'apt-pickers' },
    el('div', { class: 'apt-row' }, sidoSelect, districtSelect),
    el('div', { class: 'apt-row' }, findButton),
    el('div', { class: 'apt-complex', hidden: true }, complexFilter, complexSelect, areaSelect),
    el('div', { class: 'apt-row' }, priceButton));
  const notReady = el('p', { class: 'muted small' },
    !sheetUrl ? '구글 시트를 연결하면 실거래가를 받을 수 있어요. ' : !sheet.aptTrades ? '시트 코드를 최신으로 바꾸면 실거래가를 받을 수 있어요. ' : '시트 코드에 공공데이터 인증키를 넣으면 실거래가를 받을 수 있어요. ',
    el('a', { href: '#guide', text: '연결 가이드 보기' }));
  const autoSection = el('fieldset', { class: 'apt-auto' },
    autoToggle.element,
    aptReady ? null : notReady,
    current, pickers, status, result, autoError,
    el('p', { class: 'muted small', text: '1년 동안 거래가 없으면 아래에 직접 적은 시세를 써요.' }));

  const setStatus = (text, tone = '') => {
    status.hidden = !text;
    status.textContent = text ?? '';
    status.className = `apt-status small ${tone}`.trim();
  };

  function showResult() {
    clear(result);
    result.hidden = !market;
    if (!market) return;
    if (!market.average) {
      result.append(el('p', { class: 'muted', text: '최근 1년 동안 이 단지·전용면적의 거래가 없어요. 아래에 직접 적은 시세를 써요.' }));
      return;
    }
    result.append(
      el('p', {}, el('strong', { text: money(market.average) }), ` · ${aptLabel(market)}`),
      market.min && market.max && market.count > 1 ? el('p', { class: 'muted small', text: `가장 낮은 ${money(market.min)} ~ 가장 높은 ${money(market.max)}` }) : null,
      market.trades?.length
        ? el('ul', { class: 'apt-trades' }, market.trades.slice(0, 5).map((trade) => el('li', { class: 'small', text: `${formatDate(trade.date)} · ${trade.floor}층 · ${money(trade.amount)}` })))
        : null,
      el('p', { class: 'muted small', text: `${formatDate(market.fetchedAt.slice(0, 10))}에 받았어요.` }));
  }

  function showCurrent() {
    current.hidden = !auto;
    current.textContent = auto ? `고른 단지: ${auto.name}${auto.dong ? ` (${auto.dong})` : ''} · 전용 ${areaText(auto.area)}${auto.district ? ` · ${auto.district}` : ''}` : '';
  }

  // 시·도 → 시·군·구
  let districts = [];
  loadDistricts().then((list) => {
    districts = list;
    const sidos = [...new Set(list.map((district) => district.sido))];
    sidos.forEach((sido) => sidoSelect.append(el('option', { value: sido, text: sido })));
    const chosen = auto ? list.find((district) => district.code === auto.lawd) : null;
    if (chosen) {
      sidoSelect.value = chosen.sido;
      fillDistricts();
      districtSelect.value = chosen.code;
    }
  }).catch(() => setStatus('시·군·구 목록을 불러오지 못했어요. 새로고침해 주세요.', 'warn-text'));

  function fillDistricts() {
    clear(districtSelect);
    districtSelect.append(el('option', { value: '', text: '시·군·구' }));
    districts.filter((district) => district.sido === sidoSelect.value)
      .forEach((district) => districtSelect.append(el('option', { value: district.code, text: district.name })));
  }
  // 지역을 바꾸면 전에 찾은 단지 목록은 그 지역 것이 아니므로 지운다
  function resetComplexes() {
    complexes = [];
    complexLawd = '';
    complexBox.hidden = true;
    clear(complexSelect);
    fillAreas();
    selectionChanged();
  }
  sidoSelect.addEventListener('change', () => { fillDistricts(); resetComplexes(); });
  districtSelect.addEventListener('change', resetComplexes);

  // 단지 찾기 → 단지 → 전용면적
  let complexes = [];
  let complexLawd = '';
  const complexBox = pickers.querySelector('.apt-complex');
  const selectedComplex = () => (complexSelect.value === '' ? null : complexes[Number(complexSelect.value)] ?? null);
  function fillComplexes() {
    const word = complexFilter.value.trim().replace(/\s/g, '');
    const keep = complexSelect.value;
    clear(complexSelect);
    complexSelect.append(el('option', { value: '', text: complexes.length ? '단지를 골라 주세요' : '최근 1년 거래가 없어요' }));
    complexes.forEach((complex, index) => {
      if (word && !complex.name.replace(/\s/g, '').includes(word)) return;
      complexSelect.append(el('option', { value: String(index), text: `${complex.name}${complex.dong ? ` (${complex.dong})` : ''} · 거래 ${complex.count}건` }));
    });
    // 좁힌 뒤에도 고른 단지가 목록에 있으면 그대로 두고, 없어지면 전용면적도 다시 고르게 한다
    if (keep && [...complexSelect.options].some((option) => option.value === keep)) {
      complexSelect.value = keep;
    } else if (keep) {
      fillAreas();
      selectionChanged();
    }
  }
  complexFilter.addEventListener('input', fillComplexes);
  function fillAreas() {
    clear(areaSelect);
    areaSelect.append(el('option', { value: '', text: '전용면적' }));
    const complex = selectedComplex();
    (complex?.areas ?? []).forEach((area) => areaSelect.append(el('option', { value: String(area.area), text: `${areaText(area.area)} · 거래 ${area.count}건` })));
    if (complex?.areas.length === 1) areaSelect.value = String(complex.areas[0].area);
  }
  complexSelect.addEventListener('change', () => { fillAreas(); selectionChanged(); });
  areaSelect.addEventListener('change', selectionChanged);

  // 단지 찾기로 지금 고른 단지·전용면적. 덜 골랐으면 null
  function pickedTarget() {
    const complex = selectedComplex();
    const area = Number(areaSelect.value);
    if (!complex || !(area > 0) || !complexLawd) return null;
    const district = districts.find((entry) => entry.code === complexLawd);
    return {
      lawd: complexLawd, district: district ? `${district.sido} ${district.name}` : '', apt: complex.apt ?? '', name: complex.name, dong: complex.dong ?? '', area,
    };
  }
  // 단지를 고르는 중인데 보여 주는 실거래가가 그 단지·전용면적 것이 아니면 true
  const pickingOther = () => selectedComplex() != null && !sameTarget(pickedTarget(), auto);

  // 단지나 전용면적을 바꾸면: 예전 결과는 감추고, 전용면적까지 골랐으면 바로 새로 받아온다
  function selectionChanged() {
    autoError.hidden = true;
    const target = pickedTarget();
    if (target && !sameTarget(target, auto)) loadPrice(target);
    else {
      // 덜 골랐거나 이미 보여 주는 것으로 되돌아왔으면, 받는 중이던 예전 요청의 답은 쓰지 않는다
      priceRequest += 1;
      priceButton.disabled = false;
      setStatus(!target && selectedComplex() ? '전용면적을 골라 주세요.' : '');
    }
    refreshAuto();
  }

  findButton.addEventListener('click', async () => {
    if (!districtSelect.value) {
      setStatus('시·도와 시·군·구를 먼저 골라 주세요.', 'warn-text');
      return;
    }
    const lawd = districtSelect.value;
    findButton.disabled = true;
    setStatus('최근 1년 동안 거래된 단지를 찾는 중이에요… (10초쯤 걸려요)');
    try {
      const found = await fetchAptComplexes(sheetUrl, lawd);
      if (districtSelect.value !== lawd) return; // 그사이 다른 지역을 골랐으면 버린다
      complexes = found;
      complexLawd = lawd;
      complexBox.hidden = false;
      complexFilter.value = '';
      clear(complexSelect);
      fillComplexes();
      fillAreas();
      selectionChanged();
      setStatus(`단지 ${complexes.length}곳을 찾았어요. 단지와 전용면적을 고르면 실거래가를 바로 받아와요.`);
      complexFilter.focus();
    } catch (error) {
      setStatus(error.message ?? APT_ERROR_MESSAGES.api, 'warn-text');
    } finally {
      findButton.disabled = false;
    }
  });

  // 실거래가 받아오기. 여러 번 바꿔 고르면 마지막으로 고른 것의 답만 쓴다
  let priceRequest = 0;
  async function loadPrice(target) {
    priceRequest += 1;
    const request = priceRequest;
    priceButton.disabled = true;
    setStatus(`${target.name} 전용 ${areaText(target.area)} 실거래가를 받는 중이에요…`);
    try {
      const next = await fetchAptPrice(sheetUrl, target);
      if (request !== priceRequest) return;
      const name = nameField.control.value.trim();
      if (!name || name === auto?.name) nameField.control.value = target.name; // 단지명으로 채운 이름이면 새 단지명으로
      market = next;
      auto = target;
      showCurrent();
      showResult();
      autoError.hidden = true;
      setStatus('');
      refreshAuto();
    } catch (error) {
      if (request !== priceRequest) return;
      setStatus(error.message ?? APT_ERROR_MESSAGES.api, 'warn-text');
    } finally {
      if (request === priceRequest) priceButton.disabled = false;
    }
  }

  priceButton.addEventListener('click', () => {
    if (selectedComplex() && !areaSelect.value) {
      setStatus('전용면적을 골라 주세요.', 'warn-text');
      return;
    }
    const target = pickedTarget() ?? auto;
    if (!target) {
      setStatus('"단지 찾기"로 단지와 전용면적을 먼저 골라 주세요.', 'warn-text');
      return;
    }
    loadPrice(target);
  });

  function refreshAuto() {
    const apartment = kindField.control.value === '아파트';
    autoSection.hidden = !apartment;
    const on = apartment && autoToggle.control.checked;
    autoToggle.control.disabled = !aptReady && !auto;
    pickers.hidden = !on || !aptReady;
    // 다른 단지·전용면적을 고르는 중이면 예전 결과는 감춘다 (헷갈리지 않게)
    const stale = pickingOther();
    current.hidden = !on || !auto || stale;
    result.hidden = !on || !market || stale;
    valueField.element.querySelector('.field-label').textContent = on ? '직접 적는 시세 (거래가 없을 때 사용, 선택)' : '시세';
  }
  kindField.control.addEventListener('change', refreshAuto);
  autoToggle.control.addEventListener('change', refreshAuto);
  if (!aptReady && !auto) autoToggle.control.checked = false;
  showCurrent();
  showResult();
  refreshAuto();

  const views = { name: nameField, kind: kindField, value: valueField, baseDate: baseDateField, memo: memoField };
  const formId = uid('real-estate-form');
  const form = el('form', { class: 'form', id: formId, novalidate: true },
    nameField.element, kindField.element, autoSection, el('div', { class: 'form-pair' }, valueField.element, baseDateField.element), memoField.element);

  const deleteButton = isEdit ? el('button', { type: 'button', class: 'btn btn-danger', text: '삭제' }) : null;
  const cancelButton = el('button', { type: 'button', class: 'btn', text: '취소' });
  const saveButton = el('button', { type: 'submit', form: formId, class: 'btn btn-primary', text: isEdit ? '저장' : '추가' });
  const { close } = openModal({ title: isEdit ? '부동산 수정' : '부동산 추가', body: form, footer: [deleteButton, el('span', { class: 'spacer' }), cancelButton, saveButton] });
  cancelButton.addEventListener('click', close);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const useAuto = kindField.control.value === '아파트' && autoToggle.control.checked && (aptReady || auto);
    const checked = validateRealEstate({
      id: input.id, name: nameField.control.value, kind: kindField.control.value, value: valueField.control.value,
      baseDate: baseDateField.control.value, memo: memoField.control.value,
      auto: useAuto ? auto ?? { lawd: '00000' } : null, market: useAuto ? market : null,
    });
    Object.entries(views).forEach(([key, view]) => view.setError(checked.errors[key] ?? null));
    autoError.hidden = !checked.errors.auto;
    autoError.textContent = checked.errors.auto ?? '';
    if (useAuto && !auto) {
      autoError.hidden = false;
      autoError.textContent = '"단지 찾기"로 단지와 전용면적을 고르고 "실거래가 받아오기"를 눌러 주세요. 직접 적으려면 자동 계산을 끄세요.';
      return;
    }
    // 새로 고른 단지·전용면적의 실거래가를 아직 못 받았으면, 예전 것으로 저장하지 않는다
    if (useAuto && aptReady && pickingOther()) {
      autoError.hidden = false;
      autoError.textContent = pickedTarget()
        ? '고른 단지·전용면적의 실거래가를 아직 받지 못했어요. 잠시 기다리거나 "실거래가 받아오기"를 눌러 주세요.'
        : '전용면적까지 골라 주세요. 실거래가를 바로 받아와요.';
      return;
    }
    if (!checked.ok) {
      const firstKey = Object.keys(views).find((key) => checked.errors[key]);
      views[firstKey]?.element.querySelector('input, select, textarea')?.focus();
      return;
    }
    updateState((draft) => {
      const index = draft.realEstate.findIndex((entry) => entry.id === checked.value.id);
      if (index >= 0) draft.realEstate[index] = checked.value;
      else draft.realEstate.push(checked.value);
    });
    close();
    showToast(isEdit ? '저장했어요' : '부동산을 추가했어요');
  });

  deleteButton?.addEventListener('click', async () => {
    const confirmed = await confirmDialog({ title: '부동산 삭제', message: `'${item.name}'을(를) 삭제할까요?`, confirmText: '삭제', danger: true });
    if (!confirmed) return;
    updateState((draft) => { draft.realEstate = draft.realEstate.filter((entry) => entry.id !== item.id); });
    close();
    showToast('삭제했어요');
  });
}
