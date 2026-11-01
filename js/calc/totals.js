// 총자산 계산에 쓰는 기타 금융자산 합계와 지금 자산 요약.
// 계좌에 연결한 적립형 연금은 그 계좌의 보유 종목으로 이미 계산되므로 더하지 않는다 (이중 합산 방지).
// 예수금(계좌에 남은 현금, cashInKRW의 byAccount)은 투자자산과 그 계좌 금액에 더한다.

import { DEPOSIT_ASSET_CLASS, PENSION_ASSET_CLASS } from '../constants.js';

function positive(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

// 공제회·예적금 적립금 + 계좌에 연결하지 않은 적립형 연금 적립금
export function otherFinancialAssets({ otherAssets = [], pensions = [] } = {}) {
  const deposits = otherAssets.reduce((sum, asset) => sum + positive(asset?.balance), 0);
  const pensionBalance = pensions
    .filter((pension) => pension?.kind === 'accumulating' && !pension.linkedAccount)
    .reduce((sum, pension) => sum + positive(pension.balance), 0);
  return { deposits, pensionBalance, total: deposits + pensionBalance };
}

// 계좌별 원화 금액 = 보유 종목 평가금액 + 예수금 (적립형 연금 계좌 연결용). rows: valuePortfolio(...).rows
export function valueByAccount(rows = [], cashByAccount = {}) {
  const values = {};
  for (const row of rows) {
    if (!(row.valueKRW > 0)) continue;
    values[row.holding.account] = (values[row.holding.account] ?? 0) + row.valueKRW;
  }
  for (const [account, amount] of Object.entries(cashByAccount)) {
    if (amount > 0) values[account] = (values[account] ?? 0) + amount;
  }
  return values;
}

// 지금 자산 요약 (대시보드·월별 기록용)
//  invested: 투자자산 = 보유 종목 평가금액 + 예수금 (계좌에 연결한 연금의 종목 포함), cash: 그중 예수금
//  others: 기타 금융자산 = 공제회·예적금 + 계좌에 연결하지 않은 적립형 연금
//  byAssetClass: 자산군별 금액 (공제회·예적금과 연금 적립금도 각각 하나의 자산군으로)
export function assetSummary({ rows = [], otherAssets = [], pensions = [], cashByAccount = {} } = {}) {
  const others = otherFinancialAssets({ otherAssets, pensions });
  const byAssetClass = {};
  const add = (name, amount) => {
    if (amount > 0) byAssetClass[name] = (byAssetClass[name] ?? 0) + amount;
  };
  let invested = 0;
  for (const row of rows) {
    if (!(row.valueKRW > 0)) continue;
    invested += row.valueKRW;
    add(row.holding.assetClass, row.valueKRW);
  }
  const cash = Object.values(cashByAccount).reduce((sum, amount) => sum + positive(amount), 0);
  invested += cash;
  add('현금성', cash);
  add(DEPOSIT_ASSET_CLASS, others.deposits);
  add(PENSION_ASSET_CLASS, others.pensionBalance);
  return {
    invested,
    cash,
    others: others.total,
    total: invested + others.total,
    deposits: others.deposits,
    pensionBalance: others.pensionBalance,
    byAssetClass,
  };
}
