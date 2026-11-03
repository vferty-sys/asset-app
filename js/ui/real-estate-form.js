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
];

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
  sidoSelect.addEventListener('change', fillDistricts);

  // 단지 찾기 → 단지 → 전용면적
  let complexes = [];
  const complexBox = pickers.querySelector('.apt-complex');
  function fillComplexes() {
    const word = complexFilter.value.trim().replace(/\s/g, '');
    clear(complexSelect);
    complexSelect.append(el('option', { value: '', text: complexes.length ? '단지를 골라 주세요' : '최근 1년 거래가 없어요' }));
    complexes.forEach((complex, index) => {
      if (word && !complex.name.replace(/\s/g, '').includes(word)) return;
      complexSelect.append(el('option', { value: String(index), text: `${complex.name}${complex.dong ? ` (${complex.dong})` : ''} · 거래 ${complex.count}건` }));
    });
  }
  complexFilter.addEventListener('input', fillComplexes);
  function fillAreas() {
    clear(areaSelect);
    areaSelect.append(el('option', { value: '', text: '전용면적' }));
    const complex = complexes[Number(complexSelect.value)];
    (complex?.areas ?? []).forEach((area) => areaSelect.append(el('option', { value: String(area.area), text: `${areaText(area.area)} · 거래 ${area.count}건` })));
    if (complex?.areas.length === 1) areaSelect.value = String(complex.areas[0].area);
  }
  complexSelect.addEventListener('change', fillAreas);

  findButton.addEventListener('click', async () => {
    if (!districtSelect.value) {
      setStatus('시·도와 시·군·구를 먼저 골라 주세요.', 'warn-text');
      return;
    }
    findButton.disabled = true;
    setStatus('최근 1년 동안 거래된 단지를 찾는 중이에요… (10초쯤 걸려요)');
    try {
      complexes = await fetchAptComplexes(sheetUrl, districtSelect.value);
      complexBox.hidden = false;
      complexFilter.value = '';
      fillComplexes();
      fillAreas();
      setStatus(`단지 ${complexes.length}곳을 찾았어요. 단지와 전용면적을 골라 주세요.`);
      complexFilter.focus();
    } catch (error) {
      setStatus(error.message ?? APT_ERROR_MESSAGES.api, 'warn-text');
    } finally {
      findButton.disabled = false;
    }
  });

  priceButton.addEventListener('click', async () => {
    const complex = complexes[Number(complexSelect.value)];
    let target = auto;
    if (complex) {
      if (!areaSelect.value) {
        setStatus('전용면적을 골라 주세요.', 'warn-text');
        return;
      }
      const district = districts.find((entry) => entry.code === districtSelect.value);
      target = {
        lawd: districtSelect.value, district: district ? `${district.sido} ${district.name}` : '', apt: complex.apt ?? '', name: complex.name, dong: complex.dong ?? '', area: Number(areaSelect.value),
      };
    }
    if (!target) {
      setStatus('"단지 찾기"로 단지와 전용면적을 먼저 골라 주세요.', 'warn-text');
      return;
    }
    priceButton.disabled = true;
    setStatus('실거래가를 받는 중이에요…');
    try {
      market = await fetchAptPrice(sheetUrl, target);
      auto = target;
      showCurrent();
      showResult();
      autoError.hidden = true;
      setStatus('');
      if (!nameField.control.value.trim()) nameField.control.value = target.name;
    } catch (error) {
      setStatus(error.message ?? APT_ERROR_MESSAGES.api, 'warn-text');
    } finally {
      priceButton.disabled = false;
    }
  });

  function refreshAuto() {
    const apartment = kindField.control.value === '아파트';
    autoSection.hidden = !apartment;
    const on = apartment && autoToggle.control.checked;
    autoToggle.control.disabled = !aptReady && !auto;
    pickers.hidden = !on || !aptReady;
    current.hidden = !on || !auto;
    result.hidden = !on || !market;
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
