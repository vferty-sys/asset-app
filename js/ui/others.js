import { renderPlaceholder } from './placeholder.js';

export function render(root) {
  renderPlaceholder(root, {
    summary: '공제회·예적금과 연금을 입력하는 화면이에요.',
    items: [
      '공제회·예금·적금 입력과 수정',
      '연금 여러 개 추가 (확정 수령형 / 적립형)',
      '오래된 정보 업데이트 알림',
    ],
    stage: 6,
  });
}
