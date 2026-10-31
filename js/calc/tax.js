// 리밸런싱 매매의 수수료·세금 추정 (요청서 6-5). 추정치이며 실제 세금은 다를 수 있다.
//  수수료 = 매매 금액 × 수수료율 (국내·해외 따로)
//  국내 주식 매도: 매도 금액 × 설정의 거래세율. 국내 상장 ETF는 증권거래세가 없다.
//  해외주식 양도소득세 = (한 해 매도 차익 − 250만원) × 22%, 음수면 0
//    '올해 이미 실현한 해외 차익'을 함께 넣어 이번 매도로 늘어나는 세금을 계산한다.

import { TAX_RULES } from '../constants.js';

export function overseasCapitalGainsTax(yearGain) {
  return Math.max(0, yearGain - TAX_RULES.overseasBasicDeduction) * TAX_RULES.overseasCapitalGainsRate;
}

// lines: rebalance 결과의 매매 줄들
export function estimateCosts(lines, settings, { realizedOverseasGain = 0 } = {}) {
  let feeDomestic = 0;
  let feeOverseas = 0;
  let domesticTax = 0;
  let overseasGain = 0;
  let overseasSells = 0;
  for (const line of lines) {
    if (line.action !== 'buy' && line.action !== 'sell') continue;
    const amount = Math.abs(line.amount);
    if (line.currency === 'USD') feeOverseas += (amount * settings.feeRateOverseas) / 100;
    else feeDomestic += (amount * settings.feeRateDomestic) / 100;
    if (line.action !== 'sell') continue;
    if (line.currency === 'USD') {
      overseasSells += 1;
      overseasGain += (line.price - line.avgPrice) * line.tradeQuantity * line.fx;
    } else if (line.type !== 'etf') {
      domesticTax += (amount * settings.domesticSellTaxRate) / 100;
    }
  }
  const realized = Number.isFinite(realizedOverseasGain) ? realizedOverseasGain : 0;
  const yearTax = overseasCapitalGainsTax(overseasGain + realized);
  const overseasTax = yearTax - overseasCapitalGainsTax(realized);
  const fee = feeDomestic + feeOverseas;
  return {
    feeDomestic,
    feeOverseas,
    fee,
    domesticTax,
    overseasSells,
    overseasGain,
    overseasTax, // 이번 매도로 늘어나는(음수면 줄어드는) 양도소득세
    overseasYearTax: yearTax, // 올해 전체 예상 양도소득세
    total: fee + domesticTax + Math.max(0, overseasTax),
  };
}
