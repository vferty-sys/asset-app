import { renderPlaceholder } from './placeholder.js';

export function render(root) {
  renderPlaceholder(root, {
    summary: '퇴직 등 미래 시점의 예상 자산과 연금을 보여주는 화면이에요.',
    items: [
      '공제회·예적금 적립금 증가 그래프 (시나리오 3가지)',
      '은퇴 후 월 소득 타임라인과 소득 공백기',
      '퇴직 시점 종합 예측, 미래 금액 / 현재가치 전환',
    ],
    stage: 6,
  });
}
