import { renderPlaceholder } from './placeholder.js';

export function render(root) {
  renderPlaceholder(root, {
    summary: '가지고 있는 주식·ETF를 입력하고 평가금액을 확인하는 화면이에요.',
    items: [
      '종목 추가·수정·삭제',
      '현재가, 평가금액(원화), 손익, 비중',
      'CSV 붙여넣기로 한 번에 등록',
      '예상 연 배당금 합계',
    ],
    stage: 2,
  });
}
