// 리밸런싱: '추천 비율에서 고르기' 창. 이름난 투자자들의 자산 배분 비율을 보고 골라서 목표 비중(자산군)을 채운다.
import {
  ALLOCATION_PRESETS, presetMix, presetTargets, safeShare,
} from '../calc/allocation-presets.js';
import { ageAt, currentMonthIndex } from '../dates.js';
import { el, openModal, uid } from '../dom.js';
import { formatNumber } from '../format.js';

const PARTS = [['stocks', '주식'], ['bonds', '채권'], ['cash', '현금성'], ['other', '기타']];
const IRP_SAFE_MIN = 30;

const num = (value) => formatNumber(value, { maximumFractionDigits: 1 });
const mixText = (mix) => PARTS.filter(([key]) => mix[key] > 0).map(([key, label]) => `${label} ${num(mix[key])}`).join(' · ');

// 주식·채권·현금성·기타 막대
function mixBar(mix) {
  return el('span', { class: 'alloc-bar', role: 'img', 'aria-label': mixText(mix) },
    PARTS.filter(([key]) => mix[key] > 0).map(([key]) => el('span', { class: `alloc-part alloc-${key}`, style: `width: ${mix[key]}%` })));
}

// state: 앱 상태, growthShare: 지금 계좌의 성장주 몫, onApply(targets, preset)
export function openAllocationPicker({ state, growthShare, onApply }) {
  const { birthYear, birthMonth } = state.settings;
  const age = birthYear ? ageAt(currentMonthIndex(), birthYear, birthMonth) : null;
  const hasIrp = state.holdings.some((holding) => holding.account === 'IRP');
  const name = uid('preset');
  let chosen = null;

  const preview = el('div', { class: 'alloc-preview', 'aria-live': 'polite' },
    el('p', { class: 'muted', text: '비율을 고르면 내 계좌에 맞춘 목표 비중을 여기서 보여 드려요.' }));
  const apply = el('button', { type: 'button', class: 'btn btn-primary', text: '이 비율로 채우기', disabled: true });

  const showPreview = (preset) => {
    const mix = presetMix(preset, { age });
    const targets = presetTargets(mix, { growthShare });
    chosen = { preset, targets };
    apply.disabled = false;
    const lines = [
      el('p', { class: 'alloc-targets' },
        el('strong', { text: '내 계좌 목표: ' }),
        Object.entries(targets).map(([key, value]) => `${key} ${num(value)}%`).join(' · ')),
    ];
    if (mix.stocks > 0) {
      const growth = Math.round(growthShare * 100);
      lines.push(el('p', { class: 'muted small', text: `주식 몫 ${num(mix.stocks)}%는 지금 계좌의 성장주:배당주(${growth}:${100 - growth}) 비율대로 나눴어요.` }));
    }
    if (hasIrp && safeShare(mix) < IRP_SAFE_MIN) {
      lines.push(el('p', { class: 'banner banner-warn', text: `IRP는 안전자산(채권·현금성)을 ${IRP_SAFE_MIN}% 이상 둬야 해요. 이 비율은 안전자산이 ${num(safeShare(mix))}%라 IRP 계좌에는 그대로 쓰기 어려워요.` }));
    }
    const needs = Object.keys(targets).filter((key) => !state.holdings.some((holding) => holding.assetClass === key));
    if (needs.length > 0) {
      lines.push(el('p', { class: 'muted small', text: `지금 보유 종목에 ${needs.join('·')} 종목이 없어요. 채운 뒤 그 자산군 종목을 보유 종목에 추가하면(수량 0도 돼요) 몇 주 살지 계산해 드려요.` }));
    }
    preview.replaceChildren(...lines);
  };

  const cards = ALLOCATION_PRESETS.map((preset) => {
    const mix = presetMix(preset, { age });
    const disabled = !mix;
    const input = el('input', { type: 'radio', name, value: preset.id, class: 'alloc-radio', disabled });
    input.addEventListener('change', () => showPreview(preset));
    const ageLine = preset.byAge
      ? (age != null ? `지금 ${age}세 → ${mixText(mix)}` : '설정에 출생연도를 넣으면 쓸 수 있어요.')
      : null;
    return el('label', { class: `alloc-card${disabled ? ' is-disabled' : ''}` },
      input,
      el('span', { class: 'alloc-head' },
        el('strong', { class: 'alloc-name', text: preset.name }),
        el('span', { class: 'alloc-by muted small', text: preset.by })),
      mix ? mixBar(mix) : null,
      el('span', { class: 'alloc-mix num', text: mix ? mixText(mix) : '' }),
      el('span', { class: 'alloc-summary', text: preset.summary }),
      preset.detail || ageLine ? el('span', { class: 'alloc-detail muted small', text: [preset.detail, ageLine].filter(Boolean).join(' · ') }) : null);
  });

  const cancel = el('button', { type: 'button', class: 'btn', text: '취소' });
  const { close } = openModal({
    title: '추천 비율에서 고르기',
    body: el('div', { class: 'form alloc-picker' },
      el('p', { text: '이름난 투자자들이 제안한 자산 배분 비율이에요. 고르면 주식 계좌(보유 종목)의 목표 비중이 채워지고, 채운 뒤에 직접 고칠 수도 있어요.' }),
      el('p', { class: 'muted small', text: '투자 권유가 아니라 참고용이에요. 나이·소득·목표에 맞게 고쳐 쓰세요. 공제회·예적금·연금 적립금은 넣지 않아요.' }),
      el('p', { class: 'alloc-legend', 'aria-hidden': 'true' },
        PARTS.map(([key, label]) => el('span', { class: 'legend-item' }, el('span', { class: `alloc-swatch alloc-${key}` }), label))),
      el('div', { class: 'alloc-list', role: 'radiogroup', 'aria-label': '추천 비율' }, cards),
      preview),
    footer: [el('span', { class: 'spacer' }), cancel, apply],
  });
  cancel.addEventListener('click', close);
  apply.addEventListener('click', () => {
    if (!chosen) return;
    close();
    onApply(chosen.targets, chosen.preset);
  });
}
