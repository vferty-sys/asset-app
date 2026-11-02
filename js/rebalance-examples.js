// 리밸런싱에서 보유 종목에 없는 자산군을 살 때 보여 주는 대표 ETF 예시 (참고용이고 추천이 아니다).
// 섹터를 따로 고르지 않아도 되게 시장 전체·대표 지수를 담은 큰 ETF 위주로 골랐다 ("모둠 세트").
// 이름은 종목 목록(data/stocks.json)의 이름을 쓰고, 목록에 없으면(상장폐지 등) 보여 주지 않는다.
// 연금저축·IRP·ISA는 국내 상장 상품만 살 수 있어서, 미국 상장 ETF는 해외 주식을 살 수 있는 계좌에서만 보여 준다.

import { OVERSEAS_ACCOUNTS } from './constants.js';
import { findByTicker } from './stock-list.js';

// 한 자산군에 보여 줄 예시 수 (국내 상장 + 미국 상장)
const MAX_EXAMPLES = 4;
const MAX_OVERSEAS = 2;

// name은 종목 목록을 받지 못했을 때 쓰는 이름
export const CLASS_EXAMPLES = Object.freeze({
  성장주: {
    label: '시장 전체 주식 ETF',
    note: '한 나라나 여러 나라의 대표 회사들을 통째로 담아서, 기술·금융·헬스케어 같은 업종이 시장 비율대로 나뉘어요.',
    domestic: [
      { ticker: 'KRX:069500', name: 'KODEX 200', currency: 'KRW' },
      { ticker: 'KRX:360750', name: 'TIGER 미국S&P500', currency: 'KRW' },
      { ticker: 'KRX:251350', name: 'KODEX MSCI선진국', currency: 'KRW' },
    ],
    overseas: [
      { ticker: 'NYSEARCA:VTI', name: 'Vanguard Total Stock Market ETF', currency: 'USD' },
      { ticker: 'NYSEARCA:VT', name: 'Vanguard Total World Stock ETF', currency: 'USD' },
    ],
  },
  배당주: {
    label: '배당 ETF',
    note: '배당을 꾸준히 주는 회사들을 모아 담아요.',
    domestic: [
      { ticker: 'KRX:458730', name: 'TIGER 미국배당다우존스', currency: 'KRW' },
      { ticker: 'KRX:446720', name: 'SOL 미국배당다우존스', currency: 'KRW' },
    ],
    overseas: [
      { ticker: 'NYSEARCA:SCHD', name: 'Schwab U.S. Dividend Equity ETF', currency: 'USD' },
      { ticker: 'NYSEARCA:VYM', name: 'Vanguard High Dividend Yield ETF', currency: 'USD' },
    ],
  },
  채권: {
    label: '채권 ETF',
    note: '나라(국채)나 우량 회사의 채권을 담아요. 주식이 떨어질 때 덜 흔들리게 받쳐 줘요.',
    domestic: [
      { ticker: 'KRX:114260', name: 'KODEX 국고채3년', currency: 'KRW' },
      { ticker: 'KRX:273130', name: 'KODEX 종합채권(AA-이상)액티브', currency: 'KRW' },
      { ticker: 'KRX:0085P0', name: 'ACE 미국10년국채액티브', currency: 'KRW' },
    ],
    overseas: [
      { ticker: 'NASDAQ:BND', name: 'Vanguard Total Bond Market ETF', currency: 'USD' },
      { ticker: 'NASDAQ:IEF', name: 'iShares 7-10 Year Treasury Bond ETF', currency: 'USD' },
    ],
  },
  현금성: {
    label: '현금성 ETF',
    note: '예금처럼 거의 움직이지 않고 이자만큼 조금씩 올라요. 사지 않고 예수금으로 그냥 둬도 현금성 자산이에요.',
    domestic: [
      { ticker: 'KRX:488770', name: 'KODEX 머니마켓액티브', currency: 'KRW' },
      { ticker: 'KRX:459580', name: 'KODEX CD금리액티브(합성)', currency: 'KRW' },
      { ticker: 'KRX:0046A0', name: 'TIGER 미국초단기(3개월이하)국채', currency: 'KRW' },
    ],
    overseas: [
      { ticker: 'NYSE:SGOV', name: 'iShares 0-3 Month Treasury Bond ETF', currency: 'USD' },
      { ticker: 'NYSEARCA:BIL', name: 'SPDR Bloomberg 1-3 Month T-Bill ETF', currency: 'USD' },
    ],
  },
  기타: {
    label: '금·리츠 ETF',
    note: '금은 주식·채권과 다르게 움직이고, 리츠는 건물 임대료를 나눠 받는 부동산이에요.',
    domestic: [
      { ticker: 'KRX:411060', name: 'ACE KRX금현물', currency: 'KRW' },
      { ticker: 'KRX:329200', name: 'TIGER 리츠부동산인프라', currency: 'KRW' },
      { ticker: 'KRX:352560', name: 'KODEX 미국부동산리츠(H)', currency: 'KRW' },
    ],
    overseas: [
      { ticker: 'NYSEARCA:GLD', name: 'SPDR Gold Shares', currency: 'USD' },
      { ticker: 'NYSEARCA:VNQ', name: 'Vanguard Real Estate ETF', currency: 'USD' },
    ],
  },
});

// 미국 상장 ETF를 살 수 있는 계좌인지. account가 null이면(전체 계산) 계좌를 정하지 않았으니 함께 보여 준다.
export const canBuyOverseas = (account) => account == null || OVERSEAS_ACCOUNTS.includes(account);

// 자산군·계좌에 맞는 예시: [{ ticker, name, currency, overseas, item }]
//  items: 종목 목록 (loadStockList). null이면 목록을 아직 못 받은 것 → 적어 둔 이름으로 보여 준다.
export function examplesFor(assetClass, account, items = null) {
  const set = CLASS_EXAMPLES[assetClass];
  if (!set) return [];
  const pick = (list, overseas) => list
    .map((example) => {
      const item = items ? findByTicker(items, example.ticker) : null;
      if (items && !item) return null; // 목록에서 빠진 종목(상장폐지 등)은 보여 주지 않는다
      return { ...example, name: item?.name ?? example.name, overseas, item };
    })
    .filter(Boolean);
  const overseas = canBuyOverseas(account) ? pick(set.overseas, true).slice(0, MAX_OVERSEAS) : [];
  const domestic = pick(set.domestic, false).slice(0, MAX_EXAMPLES - overseas.length);
  return [...domestic, ...overseas];
}
