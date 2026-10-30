// 헤더의 시세 표시: "시세 기준: 10:00 (약 20분 지연)" — 누르면 새로고침.
// 시트 주소가 없으면 직접 입력 모드라고 알리고 연결 가이드로 안내한다.

import { getMarket, getPriceStatus, refreshPrices, subscribeMarket } from '../market.js';
import { el, clear, svg, showToast } from '../dom.js';
import { formatQuoteTime } from '../format.js';

function refreshIcon() {
  return svg('svg', { class: 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' },
    svg('path', { d: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5' }));
}

function linkIcon() {
  return svg('svg', { class: 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' },
    svg('path', { d: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1' }));
}

export function mountPriceStatus(container, { getState, subscribe }) {
  function draw() {
    clear(container);
    const state = getState();
    const market = getMarket(state);
    if (market.mode === 'manual') {
      container.append(el('a', {
        class: 'status-chip', href: '#guide', title: '구글 시트를 연결하면 현재가와 환율을 자동으로 받아와요.',
      }, linkIcon(), el('span', { class: 'chip-long', text: '시세 직접 입력 중 · 시트 연결하기' }), el('span', { class: 'chip-short', text: '시트 연결' })));
      return;
    }

    const status = getPriceStatus();
    const loading = status.state === 'loading';
    const failed = status.state === 'error';
    const time = market.updatedAt ? formatQuoteTime(market.updatedAt) : null;
    let long = time ? `시세 기준: ${time} (약 20분 지연)` : '시세를 아직 받지 못했어요';
    let short = time ? `${time} 기준` : '시세 없음';
    if (loading) {
      long = '시세 받는 중…';
      short = '받는 중…';
    }
    const label = failed
      ? `새 시세를 받지 못했어요${time ? `(마지막 시세 ${time})` : ''}. ${status.message} 누르면 다시 시도해요.`
      : `${long}. 누르면 시세를 새로 받아와요.`;

    const button = el('button', {
      type: 'button',
      class: `status-chip${failed ? ' is-error' : ''}${loading ? ' is-loading' : ''}`,
      title: label,
      'aria-label': label,
      disabled: loading,
    }, refreshIcon(), el('span', { class: 'chip-long', text: long }), el('span', { class: 'chip-short', text: short }));
    button.addEventListener('click', async () => {
      const result = await refreshPrices(getState().settings.sheetUrl);
      if (result.ok) showToast('시세를 새로 받아왔어요');
      else if (result.error) showToast(result.error.message, 'danger', 5000);
    });
    container.append(button);
  }

  draw();
  subscribe(draw);
  subscribeMarket(draw);
}
