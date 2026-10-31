// "샘플 데이터로 둘러보기"용 가상의 데이터. 실제 사람의 자산이 아니며, 가격도 직접 입력한 예시 값이다.
// 날짜는 불러오는 날을 기준으로 정한다 (적립금 기준일 = 이번 달 1일, 월별 기록 = 지난 6개월).

import { assetSummary } from './calc/totals.js';
import { valuePortfolio } from './calc/valuation.js';
import { currentMonthIndex, toYearMonth, todayString } from './dates.js';
import { createDefaultData, normalizeData } from './storage.js';

const SETTINGS = {
  manualFxUsdKrw: 1380,
  birthYear: 1980,
  birthMonth: 5,
  retirementDate: '2040-02',
  monthlyLivingCost: 3_000_000,
  stockMonthlyInvestment: 500_000,
};

const stock = (id, name, ticker, o) => ({
  id, name, ticker, type: 'stock', currency: 'KRW', account: '일반', assetClass: '성장주', countryMix: { 한국: 100 }, memo: '', ...o,
});
const etf = (id, name, ticker, o) => ({ ...stock(id, name, ticker, o), type: 'etf' });

const HOLDINGS = [
  stock('s1', '삼성전자', 'KRX:005930', {
    quantity: 150, avgPrice: 62_000, manualPrice: 68_000, sectorMix: { 기술: 100 }, dividendPerShare: 1_444,
  }),
  etf('s2', 'KODEX 200', 'KRX:069500', {
    quantity: 120, avgPrice: 33_000, manualPrice: 36_500, dividendPerShare: 600,
    sectorMix: { 기술: 35, 금융: 15, 산업재: 15, 소비재: 10, 헬스케어: 10, 기타: 15 },
  }),
  etf('s3', 'TIGER 미국S&P500', 'KRX:360750', {
    quantity: 900, avgPrice: 15_500, manualPrice: 19_800, account: '연금저축', countryMix: { 미국: 100 }, dividendPerShare: 220,
    sectorMix: { 기술: 32, 헬스케어: 12, 금융: 13, 소비재: 10, 통신: 9, 산업재: 8, 기타: 16 },
  }),
  etf('s4', 'QQQ', 'NASDAQ:QQQ', {
    currency: 'USD', quantity: 12, avgPrice: 380, manualPrice: 480, countryMix: { 미국: 100 }, dividendPerShare: 2.8,
    sectorMix: { 기술: 58, 통신: 15, 소비재: 18, 헬스케어: 6, 기타: 3 },
  }),
  etf('s5', 'SCHD', 'NYSEARCA:SCHD', {
    currency: 'USD', quantity: 150, avgPrice: 25, manualPrice: 27.5, assetClass: '배당주', countryMix: { 미국: 100 }, dividendPerShare: 1,
    sectorMix: { 금융: 20, 필수소비재: 20, 헬스케어: 15, 산업재: 15, 에너지: 10, 기타: 20 },
  }),
  etf('s6', '국고채 10년 ETF', 'KRX:148070', {
    quantity: 60, avgPrice: 110_500, manualPrice: 112_000, account: 'IRP', assetClass: '채권', sectorMix: { 채권: 100 }, dividendPerShare: 2_000,
  }),
  etf('s7', '단기 통안채 ETF', 'KRX:157450', {
    quantity: 40, avgPrice: 104_000, manualPrice: 105_200, account: 'ISA', assetClass: '현금성', sectorMix: { 현금성: 100 },
  }),
];

const TARGETS = { mode: 'assetClass', assetClass: { 성장주: 50, 배당주: 20, 채권: 20, 현금성: 10 }, ticker: {} };

// 지난 6개월 기록: 지금 금액에서 조금씩 줄여 가며 거꾸로 만든다 (투자자산은 오르내림을 섞어서)
const INVESTED_STEPS = [0.9, 0.93, 0.92, 0.95, 0.97, 0.985];
const OTHERS_STEPS = [0.955, 0.963, 0.97, 0.978, 0.985, 0.993];

export function createSampleData(now = new Date()) {
  const thisMonth = currentMonthIndex(now);
  const month = (offset) => toYearMonth(thisMonth + offset);
  const base = createDefaultData(now);
  const draft = {
    ...base,
    settings: { ...base.settings, ...SETTINGS },
    holdings: HOLDINGS,
    otherAssets: [
      {
        id: 'o1', name: '행정공제회', type: '공제회', balance: 40_000_000, accruedInterest: 8_000_000, baseDate: `${month(0)}-01`,
        monthlyContribution: 600_000, contributionGrowthRate: 0, interestRates: { low: 4, base: 4.5, high: 5 }, compounding: '월복리',
        contributionEndDate: '2040-01', payoutDate: '2040-02', applyTax: true, taxRate: 3, updatedAt: todayString(now),
      },
      {
        id: 'o2', name: 'OO은행 정기예금', type: '예금', balance: 20_000_000, accruedInterest: 0, baseDate: `${month(0)}-01`,
        monthlyContribution: 0, contributionGrowthRate: 0, interestRates: { low: 3.2, base: 3.2, high: 3.2 }, compounding: '단리',
        contributionEndDate: null, payoutDate: month(12), applyTax: true, taxRate: 15.4, updatedAt: todayString(now),
      },
    ],
    pensions: [
      {
        id: 'p1', name: '공무원연금', category: '공무원연금', kind: 'fixed', startAge: 65, payoutType: '종신', payoutYears: null,
        applyTax: true, taxRate: 4, expectedMonthlyAmount: 2_400_000, amountBasis: 'present', inflationIndexed: true,
        inquiryDate: todayString(now), updatedAt: todayString(now), memo: '',
      },
      {
        id: 'p2', name: '연금저축', category: '연금저축', kind: 'accumulating', startAge: 60, payoutType: '기간 지정', payoutYears: 20,
        applyTax: true, taxRate: 5.5, linkedAccount: '연금저축', balance: 0, baseDate: null, monthlyContribution: 300_000,
        contributionEndDate: '2040-01', expectedReturns: { low: 3, base: 5, high: 7 }, updatedAt: todayString(now), memo: '',
      },
      {
        id: 'p3', name: 'IRP', category: 'IRP', kind: 'accumulating', startAge: 60, payoutType: '기간 지정', payoutYears: 10,
        applyTax: true, taxRate: 5.5, linkedAccount: 'IRP', balance: 0, baseDate: null, monthlyContribution: 200_000,
        contributionEndDate: '2040-01', expectedReturns: { low: 2, base: 3.5, high: 5 }, updatedAt: todayString(now), memo: '',
      },
    ],
    targets: TARGETS,
    meta: { ...base.meta, onboardingDone: true, sample: true },
  };

  const { rows } = valuePortfolio(draft.holdings, { prices: {}, fxRate: SETTINGS.manualFxUsdKrw });
  const summary = assetSummary({ rows, otherAssets: draft.otherAssets, pensions: draft.pensions });
  draft.snapshots = INVESTED_STEPS.map((step, index) => ({
    month: month(index - INVESTED_STEPS.length),
    date: `${month(index - INVESTED_STEPS.length)}-28`,
    invested: summary.invested * step,
    others: summary.others * OTHERS_STEPS[index],
  }));
  return normalizeData(draft);
}
