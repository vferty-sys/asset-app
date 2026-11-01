// 화면 표시용 포맷 함수. 값이 없거나 숫자가 아니면 '–'를 돌려준다.

export const EMPTY = '–';

const MAN = 1e4;
const EOK = 1e8;

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function formatNumber(value, { maximumFractionDigits = 0, minimumFractionDigits = 0 } = {}) {
  if (!isNumber(value)) return EMPTY;
  return value.toLocaleString('ko-KR', { maximumFractionDigits, minimumFractionDigits });
}

function signOf(value, signed) {
  if (value < 0) return '-';
  return signed && value > 0 ? '+' : '';
}

// 원화 금액. unit: 'auto'(만원·억원 자동) | 'won'(원 단위) | 'man'(만원 단위)
// 예) auto: 9,500원 / 2,346만원 / 1억 2,346만원 / 3억원
export function formatMoney(value, { unit = 'auto', signed = false } = {}) {
  if (!isNumber(value)) return EMPTY;
  const won = Math.round(Math.abs(value));
  const sign = won === 0 ? '' : signOf(value, signed);

  if (unit === 'won' || won < MAN) return `${sign}${formatNumber(won)}원`;

  const man = Math.round(won / MAN);
  if (unit === 'man' || man < MAN) return `${sign}${formatNumber(man)}만원`;

  const eok = Math.floor(man / MAN);
  const restMan = man % MAN;
  return restMan === 0
    ? `${sign}${formatNumber(eok)}억원`
    : `${sign}${formatNumber(eok)}억 ${formatNumber(restMan)}만원`;
}

// 원 금액을 한글 단위로 빠짐없이 읽는다 (입력 칸 아래에서 자릿수 확인용, 반올림하지 않음).
// 예) 150 → '150원', 1,500,000 → '150만원', 1,234,567 → '123만 4,567원', 1,234,500,000 → '12억 3,450만원'
export function formatWonExact(value) {
  if (!isNumber(value)) return EMPTY;
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs < MAN) return `${sign}${formatNumber(abs, { maximumFractionDigits: 2 })}원`;
  const won = Math.round(abs);
  const parts = [
    [Math.floor(won / EOK), '억'],
    [Math.floor((won % EOK) / MAN), '만'],
    [won % MAN, ''],
  ].filter(([amount]) => amount > 0).map(([amount, unit]) => `${formatNumber(amount)}${unit}`);
  return `${sign}${parts.join(' ')}원`;
}

// 그래프 축용 짧은 금액. 2,500,000 → '250만', 120,000,000 → '1.2억'
export function formatMoneyShort(value) {
  if (!isNumber(value)) return EMPTY;
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= EOK) return `${sign}${formatNumber(abs / EOK, { maximumFractionDigits: 1 })}억`;
  if (abs >= MAN) return `${sign}${formatNumber(Math.round(abs / MAN))}만`;
  return `${sign}${formatNumber(Math.round(abs))}`;
}

// 종목 가격. 원화는 정수, 달러는 소수 둘째 자리까지.
export function formatPrice(value, currency) {
  if (!isNumber(value)) return EMPTY;
  if (currency === 'USD') {
    const text = formatNumber(Math.abs(value), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${value < 0 ? '-' : ''}$${text}`;
  }
  return `${formatNumber(Math.round(value))}원`;
}

// 비율(0~1)을 퍼센트 문자열로. 예) 0.523 → '52.3%'
export function formatPercent(ratio, { digits = 1, signed = false } = {}) {
  if (!isNumber(ratio)) return EMPTY;
  const percent = ratio * 100;
  const text = formatNumber(Math.abs(percent), { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const isZero = Number(text.replace(/,/g, '')) === 0;
  return `${isZero ? '' : signOf(percent, signed)}${text}%`;
}

// 안내 문장용 짧은 퍼센트. 0.52 → '52%', 0.404 → '40.4%'
export function formatPercentShort(ratio) {
  if (!isNumber(ratio)) return EMPTY;
  return `${Number((ratio * 100).toFixed(1)).toLocaleString('ko-KR')}%`;
}

// 앞 낱말의 받침에 맞는 조사를 고른다. josa('한국', '이', '가') → '이', josa('기술주', '이', '가') → '가'
export function josa(word, withFinal, withoutFinal) {
  const code = String(word ?? '').trim().slice(-1).charCodeAt(0) - 0xac00;
  if (!(code >= 0 && code <= 11171)) return withoutFinal;
  const final = code % 28;
  // '으로/로'는 ㄹ 받침 뒤에서도 '로'를 쓴다 (예: 서울로)
  if (final === 0 || (withFinal === '으로' && final === 8)) return withoutFinal;
  return withFinal;
}

// 'YYYY-MM-DD' 문자열이나 Date → '2026.10.30'
export function formatDate(value) {
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return match ? `${match[1]}.${match[2]}.${match[3]}` : EMPTY;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}.${mm}.${dd}`;
  }
  return EMPTY;
}

// 'YYYY-MM' → '2044년 6월'
export function formatYearMonth(value) {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})$/.exec(value) : null;
  return match ? `${match[1]}년 ${Number(match[2])}월` : EMPTY;
}

// 시세 시각. 오늘이면 '10:05', 다른 날이면 '10/29 10:05'
export function formatQuoteTime(value, now = new Date()) {
  const date = new Date(value);
  if (value == null || Number.isNaN(date.getTime())) return EMPTY;
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return date.toDateString() === now.toDateString() ? time : `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

// 손익 색상용 CSS 클래스. 실제 색은 CSS 변수(--gain, --loss)가 정한다.
export function pnlClass(value) {
  if (!isNumber(value) || value === 0) return 'is-flat';
  return value > 0 ? 'is-gain' : 'is-loss';
}
