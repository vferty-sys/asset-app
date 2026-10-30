// 총자산 계산에 쓰는 기타 금융자산 합계.
// 계좌에 연결한 적립형 연금은 그 계좌의 보유 종목으로 이미 계산되므로 더하지 않는다 (이중 합산 방지).

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
