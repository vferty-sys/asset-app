// 첫 사용 가이드 (요청서 7장): 시트 연결 → 종목 입력 → 목표 비중 → 확인, 그리고 "샘플 데이터로 둘러보기"

import { el, openModal } from '../dom.js';

const STEPS = [
  {
    title: '시세 연결 (선택)',
    text: '구글 시트를 하나 만들어 연결하면 현재가와 달러 환율이 자동으로 들어와요. 건너뛰고 현재가를 직접 입력해도 돼요.',
    href: '#guide',
    link: '시트 연결 가이드',
  },
  {
    title: '보유 종목 입력',
    text: '종목명·티커·수량·평단가를 넣어요. 엑셀이나 구글 시트의 표를 복사해 한 번에 붙여넣을 수도 있어요.',
    href: '#holdings',
    link: '보유 종목으로',
  },
  {
    title: '목표 비중 정하기',
    text: '자산군(성장주·배당주·채권·현금성)별로 원하는 비중을 정하면, 무엇을 얼마나 사고팔지 계산해 드려요.',
    href: '#rebalance',
    link: '리밸런싱으로',
  },
  {
    title: '한눈에 확인',
    text: '대시보드에서 총자산·건강도 점수·예상 연금을 봐요. 공제회·예적금·연금은 기타 자산에 넣으면 미래 예측까지 이어져요.',
    href: '#others',
    link: '기타 자산으로',
  },
];

// onSample: "샘플 데이터로 둘러보기", onClose: 창이 닫힐 때 (어떤 방법으로든 한 번)
export function openOnboarding({ onSample, onClose }) {
  const sampleButton = el('button', { type: 'button', class: 'btn btn-primary', text: '샘플 데이터로 둘러보기' });
  const startButton = el('button', { type: 'button', class: 'btn', text: '직접 시작하기' });
  const body = el('div', { class: 'onboarding' },
    el('p', { class: 'onboarding-lead', text: '주식·ETF와 공제회·예적금·연금을 한곳에서 관리하는 앱이에요. 이렇게 시작해 보세요.' }),
    el('ol', { class: 'onboarding-steps' }, STEPS.map((step, index) => el('li', { class: 'onboarding-step' },
      el('span', { class: 'step-number', 'aria-hidden': 'true', text: String(index + 1) }),
      el('div', { class: 'step-body' },
        el('p', { class: 'step-title', text: step.title }),
        el('p', { class: 'step-text', text: step.text }),
        el('a', { class: 'step-link', href: step.href, text: step.link }))))),
    el('p', { class: 'onboarding-note', text: '입력한 내용은 이 기기의 브라우저에만 저장되고 어디로도 보내지 않아요. 여러 사람이 쓰는 컴퓨터라면 다 쓴 뒤 설정 → 내 데이터에서 "이 기기에서 데이터 삭제"를 눌러 주세요.' }));

  const { close } = openModal({
    title: '처음 오셨네요!',
    body,
    footer: [startButton, sampleButton],
    onClose,
  });
  startButton.addEventListener('click', close);
  sampleButton.addEventListener('click', () => {
    close();
    onSample();
  });
}
