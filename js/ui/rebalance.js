import { renderPlaceholder } from './placeholder.js';

export function render(root) {
  renderPlaceholder(root, {
    summary: '목표 비중에 맞추려면 무엇을 몇 주 사고팔지 계산하는 화면이에요.',
    items: [
      '목표 비중 입력 (자산군 단위 / 종목 단위)',
      '전체 리밸런싱 / 매수만으로 맞추기',
      '예상 수수료와 세금',
    ],
    stage: 5,
  });
}
