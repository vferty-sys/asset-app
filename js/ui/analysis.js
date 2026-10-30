import { renderPlaceholder } from './placeholder.js';

export function render(root) {
  renderPlaceholder(root, {
    summary: '내 포트폴리오가 한쪽으로 쏠려 있지 않은지 살펴보는 화면이에요.',
    items: [
      '국가·섹터·자산군·계좌별 비중 차트',
      '기준을 넘는 항목의 경고와 쉬운 설명',
      '포트폴리오 건강도 점수와 감점 사유',
    ],
    stage: 4,
  });
}
