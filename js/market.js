// 화면에서 쓰는 시세 정보(종목 가격, 환율)를 한곳에서 만든다.

import { resolveFx } from './calc/valuation.js';

export function getMarket(state) {
  return {
    prices: {},
    fx: resolveFx({ manualRate: state.settings.manualFxUsdKrw }),
  };
}
