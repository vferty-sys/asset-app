// 도넛 차트. Chart.js는 CDN에서 필요할 때만 불러오고(무결성 검사 포함),
// 불러오지 못하면 차트 없이 옆의 목록만으로도 모든 값을 볼 수 있다.

import { UNCLASSIFIED } from './constants.js';
import { formatPercentShort } from './format.js';

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

// slices: buildChartData(...).slices, money: 금액 표시 함수
export function renderDoughnut(Chart, canvas, { slices, money, label }) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
      animation: reduceMotion ? false : { duration: 300 },
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
    plugins: [{
      id: 'a11y-label',
      afterInit(chart) {
        chart.canvas.setAttribute('role', 'img');
        chart.canvas.setAttribute('aria-label', label);
      },
    }],
  });
}
