import { renderPlaceholder } from './placeholder.js';

export function render(root) {
  renderPlaceholder(root, {
    summary: '내 자산 전체를 한눈에 보여주는 화면이에요.',
    items: [
      '총자산(투자자산 + 기타 금융자산), 평가손익, 수익률',
      '예상 월 연금액',
      '포트폴리오 건강도 점수와 쏠림 경고',
      '월별 총자산 추이 차트',
    ],
    stage: 7,
  });
}
