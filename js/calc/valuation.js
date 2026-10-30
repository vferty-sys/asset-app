// 평가금액 계산 (요청서 6-1). 금액은 모두 원화 기준.
//  원화 평가금액 = 수량 × 현재가 × (USD면 환율, KRW면 1)
//  비중 = 원화 평가금액 / 원화 평가금액 합계

function isPositive(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function isNonNegative(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

// 환율 우선순위: 시트 환율 → 설정에 직접 입력한 환율 → 없음
export function resolveFx({ sheetRate = null, manualRate = null } = {}) {
  if (isPositive(sheetRate)) return { rate: sheetRate, source: 'sheet' };
  if (isPositive(manualRate)) return { rate: manualRate, source: 'manual' };
  return { rate: null, source: 'none' };
}

// 가격 우선순위: 시트 가격 → 직접 입력한 현재가 → 평단가(화면에 경고 표시)
// 시트가 알려준 통화가 종목 통화와 다르면 금액이 크게 틀어지므로 시트 가격을 쓰지 않는다.
// prices: { [티커]: { price, currency } }
export function resolvePrice(holding, prices = {}) {
  const quote = Object.hasOwn(prices, holding.ticker) ? prices[holding.ticker] : null;
  const currencyMismatch = Boolean(quote?.currency) && quote.currency !== holding.currency;
  if (isPositive(quote?.price) && !currencyMismatch) return { price: quote.price, source: 'sheet', currencyMismatch };
  if (isPositive(holding.manualPrice)) return { price: holding.manualPrice, source: 'manual', currencyMismatch };
  if (isNonNegative(holding.avgPrice)) return { price: holding.avgPrice, source: 'avg', currencyMismatch };
  return { price: null, source: 'none', currencyMismatch };
}

// 해당 통화 금액을 원화로. 달러인데 환율이 없으면 null.
export function toKRW(amount, currency, fxRate) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  if (currency === 'USD') return isPositive(fxRate) ? amount * fxRate : null;
  return amount;
}

export function valueHolding(holding, { prices = {}, fxRate = null } = {}) {
  const { price, source, currencyMismatch } = resolvePrice(holding, prices);
  const quantity = isNonNegative(holding.quantity) ? holding.quantity : 0;
  const valueKRW = price == null ? null : toKRW(quantity * price, holding.currency, fxRate);
  const costKRW = isNonNegative(holding.avgPrice) ? toKRW(quantity * holding.avgPrice, holding.currency, fxRate) : null;
  const pnlKRW = valueKRW != null && costKRW != null ? valueKRW - costKRW : null;
  return {
    holding,
    price,
    priceSource: source,
    currencyMismatch,
    valueKRW,
    costKRW,
    pnlKRW,
    returnRate: pnlKRW != null && costKRW > 0 ? pnlKRW / costKRW : null,
    dividendKRW: isNonNegative(holding.dividendPerShare)
      ? toKRW(quantity * holding.dividendPerShare, holding.currency, fxRate)
      : null,
    missingFx: holding.currency === 'USD' && !isPositive(fxRate),
  };
}

// 포트폴리오 전체 평가. 원화로 바꿀 수 없는 종목(환율 없음)은 합계와 비중에서 빠진다.
export function valuePortfolio(holdings, { prices = {}, fxRate = null } = {}) {
  const valued = (holdings ?? []).map((holding) => valueHolding(holding, { prices, fxRate }));
  const counted = valued.filter((row) => row.valueKRW != null);
  const totalValue = sum(counted.map((row) => row.valueKRW));
  const withCost = counted.filter((row) => row.costKRW != null);
  const totalCost = sum(withCost.map((row) => row.costKRW));
  const totalPnl = sum(withCost.map((row) => row.pnlKRW));
  const annualDividend = sum(valued.map((row) => row.dividendKRW ?? 0));

  return {
    rows: valued.map((row) => ({
      ...row,
      weight: row.valueKRW != null && totalValue > 0 ? row.valueKRW / totalValue : null,
    })),
    totalValue,
    totalCost,
    totalPnl,
    totalReturn: totalCost > 0 ? totalPnl / totalCost : null,
    annualDividend,
    dividendYield: totalValue > 0 ? annualDividend / totalValue : null,
    missingFxCount: valued.filter((row) => row.missingFx).length,
    avgPriceCount: valued.filter((row) => row.priceSource === 'avg').length,
  };
}
