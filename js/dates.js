// 날짜 도우미. 미래 예측은 '달' 단위로 계산한다.
// 달 번호 = 연도 × 12 + (월 − 1). 두 시점의 차이가 곧 개월 수다.

export function monthIndexOf(year, month) {
  return year * 12 + (month - 1);
}

export function yearOf(index) {
  return Math.floor(index / 12);
}

export function monthOf(index) {
  return (index % 12) + 1;
}

// 'YYYY-MM' 또는 'YYYY-MM-DD' → 달 번호 (없거나 형식이 틀리면 null)
export function parseMonth(value) {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})/.exec(value) : null;
  if (!match) return null;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? monthIndexOf(Number(match[1]), month) : null;
}

export function toYearMonth(index) {
  return `${yearOf(index)}-${String(monthOf(index)).padStart(2, '0')}`;
}

export function currentMonthIndex(now = new Date()) {
  return monthIndexOf(now.getFullYear(), now.getMonth() + 1);
}

// 오늘 날짜 'YYYY-MM-DD' (내 컴퓨터 시간 기준)
export function todayString(now = new Date()) {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

// 그 달의 만 나이
export function ageAt(index, birthYear, birthMonth = 1) {
  return Math.floor((index - monthIndexOf(birthYear, birthMonth)) / 12);
}

// 만 age세가 되는 달
export function monthIndexAtAge(age, birthYear, birthMonth = 1) {
  return monthIndexOf(birthYear + age, birthMonth);
}

// '2044년 3월'
export function formatMonthIndex(index) {
  return `${yearOf(index)}년 ${monthOf(index)}월`;
}

// 개월 수 → '5년 2개월', '8개월', '3년'
export function durationText(months) {
  const total = Math.max(0, Math.round(months));
  const years = Math.floor(total / 12);
  const rest = total % 12;
  if (years === 0) return `${rest}개월`;
  return rest === 0 ? `${years}년` : `${years}년 ${rest}개월`;
}

// 두 날짜('YYYY-MM-DD') 사이가 days일 이상 지났는지 (마지막 갱신일 알림용)
export function isOlderThan(dateString, days, now = new Date()) {
  const time = Date.parse(dateString ?? '');
  if (Number.isNaN(time)) return false;
  return now.getTime() - time > days * 24 * 60 * 60 * 1000;
}
