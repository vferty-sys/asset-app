// 예수금: 증권 계좌에 남아 있는 현금. '다음에 살 때 쓸 돈'으로 보고
//  - 총자산·계좌별 금액·연금 계좌 적립금·자산군(현금성)에는 더하고
//  - 리밸런싱에서는 지금 비중에 넣지 않고 살 돈(추가 투자금)으로 쓴다.
// 저장 모양: { 일반: { KRW: 500000, USD: 120 }, IRP: { KRW: 30000 } } — 계좌마다 원화·달러, 0인 칸은 저장하지 않는다.

import { ACCOUNTS, CURRENCIES } from './constants.js';
import { isPlainObject } from './validate.js';

export function normalizeCash(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const result = {};
  for (const account of ACCOUNTS) {
    const entry = isPlainObject(source[account]) ? source[account] : {};
    const amounts = {};
    for (const currency of CURRENCIES) {
      const value = entry[currency];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) amounts[currency] = value;
    }
    if (Object.keys(amounts).length > 0) result[account] = amounts;
  }
  return result;
}

// 원화로 바꾼 예수금. 달러는 환율이 없으면 빼고 missingUsd에 모은다.
// 돌려주는 값: { byAccount: { 계좌: 원화 }, total, missingUsd }
export function cashInKRW(cash, fxRate) {
  const byAccount = {};
  let missingUsd = 0;
  for (const [account, amounts] of Object.entries(cash ?? {})) {
    let krw = amounts.KRW ?? 0;
    if (amounts.USD > 0) {
      if (fxRate > 0) krw += amounts.USD * fxRate;
      else missingUsd += amounts.USD;
    }
    if (krw > 0) byAccount[account] = krw;
  }
  const total = Object.values(byAccount).reduce((sum, value) => sum + value, 0);
  return { byAccount, total, missingUsd };
}
