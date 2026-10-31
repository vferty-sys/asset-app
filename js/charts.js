// 차트 (도넛, 시나리오, 은퇴 후 월 소득, 총자산 추이). Chart.js는 CDN에서 필요할 때만 불러오고(무결성 검사 포함),
// 불러오지 못하면 차트 없이 옆의 목록·표만으로도 모든 값을 볼 수 있다.

import { UNCLASSIFIED } from './constants.js';
import { formatMoneyShort, formatPercentShort } from './format.js';

const CHART_SRC = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js';
const CHART_INTEGRITY = 'sha384-dug+JxfBvklEQdJ4AYuBBAIScUz0bVN73xpy273gcAwHjb3qI0fXmuYNaNfdyYJG';
const LOAD_TIMEOUT_MS = 10000;
const MAX_COLORS = 6;
const OTHER = '기타';
const REST = '그 외';

let loading = null;

export function loadChartLibrary() {
  if (globalThis.Chart) return Promise.resolve(globalThis.Chart);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let timer = null;
      const fail = (error) => {
        clearTimeout(timer);
        script.remove();
        loading = null; // 다음에 다시 시도할 수 있게
        reject(error);
      };
      timer = setTimeout(() => fail(new Error('차트 도구를 불러오는 시간이 너무 오래 걸려요.')), LOAD_TIMEOUT_MS);
      script.src = CHART_SRC;
      script.integrity = CHART_INTEGRITY;
      script.crossOrigin = 'anonymous';
      script.async = true;
      script.addEventListener('load', () => {
        clearTimeout(timer);
        if (globalThis.Chart) resolve(globalThis.Chart);
        else fail(new Error('차트 도구를 불러오지 못했어요.'));
      });
      script.addEventListener('error', () => fail(new Error('차트 도구를 불러오지 못했어요.')));
      document.head.append(script);
    });
  }
  return loading;
}

// 차트와 목록에 쓸 항목과 색을 정한다.
//  - 색은 정해진 순서(order: 국가·자산군·계좌 목록)대로 붙여서, 항목이 늘거나 줄어도 남은 항목 색이 덜 바뀐다.
//  - 색 있는 항목은 6개까지. 나머지는 '그 외'로 묶고, 기타·그 외는 회색, 미분류는 옅은 회색.
// 돌려주는 값: rows(목록용, 모든 항목) / slices(차트용, 회색 항목은 하나로 합침)
export function buildChartData(breakdown, { order = [] } = {}) {
  const neutral = new Set([OTHER, UNCLASSIFIED]);
  const named = breakdown.filter((item) => !neutral.has(item.name));
  const kept = new Set([...named].sort((a, b) => b.value - a.value).slice(0, MAX_COLORS).map((item) => item.name));
  const position = (name) => (order.includes(name) ? order.indexOf(name) : order.length);
  const colored = named.filter((item) => kept.has(item.name))
    .sort((a, b) => position(a.name) - position(b.name) || b.value - a.value)
    .map((item, index) => ({ ...item, color: `series-${index + 1}` }));
  const grouped = [
    ...breakdown.filter((item) => item.name === OTHER),
    ...named.filter((item) => !kept.has(item.name)),
  ].map((item) => ({ ...item, color: 'series-other' }));
  const unclassified = breakdown.filter((item) => item.name === UNCLASSIFIED)
    .map((item) => ({ ...item, color: 'series-unclassified' }));

  const slices = [...colored];
  if (grouped.length > 0) {
    const hasRest = grouped.some((item) => item.name !== OTHER);
    const hasOther = grouped.some((item) => item.name === OTHER);
    slices.push({
      name: hasRest && hasOther ? `${OTHER}·${REST}` : hasRest ? REST : OTHER,
      value: grouped.reduce((sum, item) => sum + item.value, 0),
      weight: grouped.reduce((sum, item) => sum + item.weight, 0),
      color: 'series-other',
    });
  }
  slices.push(...unclassified);
  return { rows: [...colored, ...grouped, ...unclassified], slices };
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
}

// '#2a78d6' → 'rgba(42, 120, 214, 0.12)'
function withAlpha(hex, alpha) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return hex;
  const [r, g, b] = match.slice(1).map((part) => parseInt(part, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function a11yLabel(label) {
  return {
    id: 'a11y-label',
    afterInit(chart) {
      chart.canvas.setAttribute('role', 'img');
      chart.canvas.setAttribute('aria-label', label);
    },
  };
}

// 축·눈금선은 흐린 단색 가는 선, 금액 축은 '250만'처럼 짧게
function moneyAxes({ stacked = false } = {}) {
  const muted = cssVar('text-muted');
  return {
    x: { stacked, grid: { display: false }, border: { color: cssVar('border-strong') }, ticks: { color: muted, maxRotation: 0, autoSkip: true, autoSkipPadding: 10 } },
    y: {
      stacked,
      beginAtZero: true,
      grid: { color: cssVar('border') },
      border: { display: false },
      ticks: { color: muted, maxTicksLimit: 5, callback: (value) => formatMoneyShort(value) },
    },
  };
}

// 시나리오 그래프: 낮음~높음 사이는 옅게 칠하고, 기준은 진한 선 (공제회·예적금 적립금 증가)
export function renderFanChart(Chart, canvas, { labels, low, base, high, money, label }) {
  const color = cssVar('series-1');
  return new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '높음', data: high, borderColor: withAlpha(color, 0.5), borderWidth: 1, pointRadius: 0, fill: '+1', backgroundColor: withAlpha(color, 0.12) },
        { label: '낮음', data: low, borderColor: withAlpha(color, 0.5), borderWidth: 1, pointRadius: 0, fill: false },
        { label: '기준', data: base, borderColor: color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHitRadius: 12, fill: false },
      ],
    },
    options: {
      maintainAspectRatio: false,
      animation: reducedMotion() ? false : { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      scales: moneyAxes(),
      plugins: {
        legend: { display: false },
        tooltip: {
          itemSort: (a, b) => b.datasetIndex - a.datasetIndex,
          callbacks: { label: (item) => ` ${item.dataset.label} ${money(item.raw)}` },
        },
      },
    },
    plugins: [a11yLabel(label)],
  });
}

// 은퇴 후 월 소득: 나이별로 연금을 쌓은 막대 + 월 목표 생활비 선 + 소득 공백기 음영
// series: [{ name, values, color }], target: 나이별 월 목표 생활비 배열 또는 null, gap: { from, to } (labels 위치) 또는 null
export function renderIncomeChart(Chart, canvas, { labels, series, target, gap, money, label }) {
  const surface = cssVar('surface');
  const datasets = series.map((item) => ({
    type: 'bar',
    label: item.name,
    data: item.values,
    backgroundColor: cssVar(item.color),
    borderColor: surface,
    borderWidth: { top: 2 },
    borderSkipped: false,
    stack: 'income',
    categoryPercentage: 0.9,
    barPercentage: 0.95,
  }));
  if (target) {
    datasets.push({
      type: 'line', label: '월 목표 생활비', data: target, borderColor: cssVar('text'),
      borderWidth: 1.5, pointRadius: 0, pointHitRadius: 0, fill: false, order: -1,
    });
  }
  const gapShade = {
    id: 'gap-shade',
    beforeDatasetsDraw(chart) {
      if (!gap) return;
      const { ctx, chartArea, scales } = chart;
      const half = (scales.x.getPixelForValue(1) - scales.x.getPixelForValue(0)) / 2 || 10;
      const left = Math.max(chartArea.left, scales.x.getPixelForValue(gap.from) - half);
      const right = Math.min(chartArea.right, scales.x.getPixelForValue(gap.to) + half);
      ctx.save();
      ctx.fillStyle = withAlpha(cssVar('warn'), 0.14);
      ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);
      ctx.restore();
    },
  };
  return new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      maintainAspectRatio: false,
      animation: reducedMotion() ? false : { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      scales: moneyAxes({ stacked: true }),
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => item.raw > 0 || item.dataset.type === 'line',
          callbacks: {
            label: (item) => ` ${item.dataset.label} ${money(item.raw)}`,
            footer: (items) => {
              const total = items.filter((item) => item.dataset.type !== 'line').reduce((sum, item) => sum + item.raw, 0);
              return `연금 합계 ${money(total)}`;
            },
          },
        },
      },
    },
    plugins: [gapShade, a11yLabel(label)],
  });
}

// 총자산 추이: 달마다 투자자산(아래)과 기타 금융자산(위)을 쌓은 막대
//  막대는 24px까지만, 맨 위 끝만 4px 둥글게, 두 막대 사이는 카드 색 2px 틈
export function renderTrendChart(Chart, canvas, { labels, invested, others, money, label }) {
  const bar = { stack: 'total', maxBarThickness: 24, categoryPercentage: 0.7, barPercentage: 0.9 };
  const roundTop = { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 };
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          ...bar,
          label: '투자자산',
          data: invested,
          backgroundColor: cssVar('series-1'),
          borderColor: cssVar('surface'),
          borderWidth: { top: 2 },
          // 위에 기타 금융자산이 없는 달은 이 막대가 맨 위
          borderRadius: (context) => (others[context.dataIndex] > 0 ? 0 : roundTop),
        },
        { ...bar, label: '기타 금융자산', data: others, backgroundColor: cssVar('series-2'), borderWidth: 0, borderRadius: roundTop },
      ],
    },
    options: {
      maintainAspectRatio: false,
      animation: reducedMotion() ? false : { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      scales: moneyAxes({ stacked: true }),
      plugins: {
        legend: { display: false },
        tooltip: {
          itemSort: (a, b) => b.datasetIndex - a.datasetIndex,
          callbacks: {
            label: (item) => ` ${item.dataset.label} ${money(item.raw)}`,
            footer: (items) => `총자산 ${money(items.reduce((sum, item) => sum + item.raw, 0))}`,
          },
        },
      },
    },
    plugins: [a11yLabel(label)],
  });
}

// slices: buildChartData(...).slices, money: 금액 표시 함수
export function renderDoughnut(Chart, canvas, { slices, money, label }) {
  return new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: slices.map((slice) => slice.name),
      datasets: [{
        data: slices.map((slice) => slice.value),
        backgroundColor: slices.map((slice) => cssVar(slice.color)),
        // 조각 사이 2px 틈 (카드 배경색)
        borderColor: cssVar('surface'),
        borderWidth: 2,
        hoverOffset: 6,
      }],
    },
    options: {
      cutout: '62%',
      maintainAspectRatio: true,
      animation: reducedMotion() ? false : { duration: 300 },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: true,
          callbacks: {
            // 값이 먼저, 이름은 그다음
            title: (items) => formatPercentShort(slices[items[0].dataIndex].weight),
            label: (item) => ` ${slices[item.dataIndex].name} · ${money(slices[item.dataIndex].value)}`,
          },
        },
      },
    },
    plugins: [a11yLabel(label)],
  });
}
