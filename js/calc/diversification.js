// 분산 집계 (요청서 6-2)와 쏠림 경고.
//  국가 비중 = Σ(종목 원화 평가금액 × countryMix[국가] / 100) / 합계 — 섹터도 같은 방식

import {
  BROAD_ASSET_CLASSES, DEPOSIT_ASSET_CLASS, ETF_SPREAD_COUNTS, NON_COUNTRY_NAMES, NON_SECTOR_NAMES, OTHER_ACCOUNT,
  PENSION_ASSET_CLASS, UNCLASSIFIED,
} from '../constants.js';
import { formatPercentShort, josa } from '../format.js';
import { otherFinancialAssets } from './totals.js';

// 한 종목의 금액을 국가·섹터 비율대로 나눈다.
// 비율 합계가 100보다 작으면 나머지는 '미분류'로, 100보다 크면 합계에 맞춰 줄여서 전체가 100%를 넘지 않게 한다.
export function splitByMix(amount, mix) {
  const entries = Object.entries(mix ?? {})
    .filter(([, percent]) => typeof percent === 'number' && Number.isFinite(percent) && percent > 0);
  const sum = entries.reduce((total, [, percent]) => total + percent, 0);
  const complete = Math.abs(sum - 100) < 0.01;
  const base = complete || sum > 100 ? sum : 100;
  const parts = entries.map(([name, percent]) => [name, (amount * percent) / base]);
  if (!complete && sum < 100) parts.push([UNCLASSIFIED, (amount * (100 - sum)) / 100]);
  return parts;
}

// [이름, 금액] 목록을 이름별로 더해 비중을 계산한다. 금액이 큰 순서로 돌려준다.
export function toBreakdown(entries) {
  const totals = new Map();
  for (const [name, amount] of entries) {
    if (!(amount > 0)) continue;
    totals.set(name, (totals.get(name) ?? 0) + amount);
  }
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
  return [...totals]
    .map(([name, value]) => ({ name, value, weight: total > 0 ? value / total : 0 }))
    .sort((a, b) => b.value - a.value);
}

// rows: valuePortfolio(...).rows. 원화로 계산할 수 없는 종목(환율 없음)은 빠진다.
// includeOthers: 자산군·계좌 집계에 공제회·예적금과 계좌에 연결하지 않은 적립형 연금을 더한다.
// 국가·섹터는 항상 주식만 집계한다.
export function analyzeDiversification(rows, { includeOthers = false, otherAssets = [], pensions = [] } = {}) {
  const valued = (rows ?? []).filter((row) => row.valueKRW > 0);
  const stockTotal = valued.reduce((sum, row) => sum + row.valueKRW, 0);
  const others = includeOthers ? otherFinancialAssets({ otherAssets, pensions }) : { deposits: 0, pensionBalance: 0, total: 0 };
  return {
    stockTotal,
    othersTotal: others.total,
    total: stockTotal + others.total,
    country: toBreakdown(valued.flatMap((row) => splitByMix(row.valueKRW, row.holding.countryMix))),
    sector: toBreakdown(valued.flatMap((row) => splitByMix(row.valueKRW, row.holding.sectorMix))),
    assetClass: toBreakdown([
      ...valued.map((row) => [row.holding.assetClass, row.valueKRW]),
      [DEPOSIT_ASSET_CLASS, others.deposits],
      [PENSION_ASSET_CLASS, others.pensionBalance],
    ]),
    account: toBreakdown([
      ...valued.map((row) => [row.holding.account, row.valueKRW]),
      [OTHER_ACCOUNT, others.total],
    ]),
  };
}

// ETF를 회사 몇 곳으로 볼지 정하는 분산 정도 (개별 주식은 null).
// 채권·현금성 ETF는 특정 회사에 몰린 위험이 아니라서 시장 전체형처럼 본다.
export function etfSpreadOf(holding) {
  if (holding.type !== 'etf') return null;
  if (BROAD_ASSET_CLASSES.includes(holding.assetClass)) return 'market';
  return Object.hasOwn(ETF_SPREAD_COUNTS, holding.etfSpread) ? holding.etfSpread : 'theme';
}

// 종목별 비중. 같은 종목을 여러 계좌에 나눠 가졌으면 하나로 합친다 (한 종목 쏠림·상위 3종목 계산용).
// parts: 점수·경고에서 이 종목을 몇 종목으로 나눠 볼지 (개별 주식 1, ETF는 분산 정도에 따라)
export function holdingWeights(rows) {
  const valued = (rows ?? []).filter((row) => row.valueKRW > 0);
  const total = valued.reduce((sum, row) => sum + row.valueKRW, 0);
  const byTicker = new Map();
  for (const { holding, valueKRW } of valued) {
    const key = holding.ticker || holding.id;
    const item = byTicker.get(key) ?? { ticker: key, name: holding.name, type: holding.type, spread: null, parts: 1, value: 0 };
    item.value += valueKRW;
    const spread = etfSpreadOf(holding);
    if (spread) {
      item.type = 'etf';
      // 같은 ETF를 계좌마다 다르게 골랐으면 더 넓게 나눈 쪽을 쓴다
      if (item.spread == null || ETF_SPREAD_COUNTS[spread] > item.parts) {
        item.spread = spread;
        item.parts = ETF_SPREAD_COUNTS[spread];
      }
    }
    byTicker.set(key, item);
  }
  return [...byTicker.values()]
    .map((item) => ({ ...item, weight: total > 0 ? item.value / total : 0 }))
    .sort((a, b) => b.value - a.value);
}

// 빼야 할 이름(기타·미분류 등)을 건너뛴 가장 큰 항목
export function largestOf(breakdown, excluded = []) {
  return breakdown.find((item) => !excluded.includes(item.name)) ?? null;
}

// '기술주가 함께 떨어지면'처럼 섹터를 쉬운 말로
const SECTOR_STOCKS = { 기술: '기술주', 통신: '통신주', 금융: '금융주', 헬스케어: '헬스케어 주식' };

function sectorStocks(name) {
  const phrase = SECTOR_STOCKS[name] ?? `${name} 관련 주식`;
  return `${phrase}${josa(phrase, '이', '가')}`;
}

// 설정의 경고 기준(%)을 넘는 섹터·국가·종목을 쉬운 설명과 함께 돌려준다.
// sector·country: 주식만 집계한 결과, holdings: holdingWeights 결과
export function concentrationAlerts({ sector = [], country = [], holdings = [] }, { warnSector, warnCountry, warnSingle }) {
  const alerts = [];
  for (const item of sector) {
    if (NON_SECTOR_NAMES.includes(item.name) || item.weight <= warnSector / 100) continue;
    alerts.push({
      kind: 'sector',
      name: item.name,
      weight: item.weight,
      limit: warnSector / 100,
      message: `${item.name} 섹터가 ${formatPercentShort(item.weight)}예요. ${sectorStocks(item.name)} 함께 떨어지면 자산이 크게 흔들릴 수 있어요.`,
    });
  }
  for (const item of country) {
    if (NON_COUNTRY_NAMES.includes(item.name) || item.weight <= warnCountry / 100) continue;
    alerts.push({
      kind: 'country',
      name: item.name,
      weight: item.weight,
      limit: warnCountry / 100,
      message: `${item.name} 비중이 ${formatPercentShort(item.weight)}예요. ${item.name} 주식시장이 함께 떨어지면 자산이 크게 흔들릴 수 있어요.`,
    });
  }
  // ETF는 분산 정도만큼 나눈 한 조각(회사 한 곳)의 비중으로 판단한다. 예: 시장 전체형 60%는 6%짜리 10곳
  for (const item of holdings) {
    const parts = item.parts ?? 1;
    if (item.weight / parts <= warnSingle / 100) continue;
    alerts.push({
      kind: 'single',
      name: item.name,
      weight: item.weight,
      limit: warnSingle / 100,
      message: `${item.name} 한 ${item.type === 'etf' ? '상품' : '종목'}이 ${formatPercentShort(item.weight)}예요. ${SINGLE_RISKS[item.spread ?? 'stock']}`,
    });
  }
  return alerts;
}

const SINGLE_RISKS = {
  stock: '이 회사에 문제가 생기면 자산이 크게 줄 수 있어요.',
  single: '레버리지·인버스·단일 종목처럼 몇 곳에 몰린 ETF라 한 종목만큼 크게 흔들릴 수 있어요.',
  theme: '같은 업종·주제의 회사들은 함께 오르내려서, 한 상품에 이만큼 몰리면 크게 흔들릴 수 있어요.',
  market: '시장 전체를 담은 ETF라도 한 상품에 이만큼 몰려 있어요.',
};
