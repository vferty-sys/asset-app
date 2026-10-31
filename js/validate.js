// 입력값 검증과 변환. 설정 화면, 저장 데이터 정리, CSV 등에서 함께 쓴다.
// coerceValue(spec, input) → { ok: true, value } 또는 { ok: false, error }

const NUMBER_PATTERN = /^[-+]?(\d+\.?\d*|\.\d+)$/;
const YEAR_MONTH_PATTERN = /^(\d{4})[-./](\d{1,2})$/;
const DATE_PATTERN = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/;

// "1,234.5" 같은 사람이 입력한 숫자를 읽는다. 빈 값은 null, 숫자가 아니면 NaN.
export function parseNumberInput(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : NaN;
  if (input == null) return null;
  const text = String(input).replace(/[,\s]/g, '');
  if (text === '') return null;
  if (!NUMBER_PATTERN.test(text)) return NaN;
  return Number(text);
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const ok = (value) => ({ ok: true, value });
const fail = (error) => ({ ok: false, error });

function plain(n) {
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 4 });
}

function rangeMessage(spec) {
  if (spec.min != null && spec.max != null) return `${plain(spec.min)} ~ ${plain(spec.max)} 사이로 입력해 주세요.`;
  if (spec.min != null) return `${plain(spec.min)} 이상으로 입력해 주세요.`;
  return `${plain(spec.max)} 이하로 입력해 주세요.`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function coerceValue(spec, input) {
  const isEmpty = input == null || (typeof input === 'string' && input.trim() === '');
  if (isEmpty) {
    if (spec.type === 'string' || spec.type === 'url') return ok('');
    if (spec.nullable) return ok(null);
    return fail(spec.type === 'enum' ? '목록에서 골라 주세요.' : '값을 입력해 주세요.');
  }

  switch (spec.type) {
    case 'number':
    case 'integer': {
      const n = parseNumberInput(input);
      if (!Number.isFinite(n)) return fail('숫자로 입력해 주세요.');
      if (spec.type === 'integer' && !Number.isInteger(n)) return fail('소수점 없이 입력해 주세요.');
      if (spec.exclusiveMin != null && n <= spec.exclusiveMin) return fail(`${plain(spec.exclusiveMin)}보다 큰 값으로 입력해 주세요.`);
      if ((spec.min != null && n < spec.min) || (spec.max != null && n > spec.max)) return fail(rangeMessage(spec));
      return ok(n);
    }
    case 'boolean': {
      if (input === true || input === 'true') return ok(true);
      if (input === false || input === 'false') return ok(false);
      return fail('예/아니요 중에서 골라 주세요.');
    }
    case 'enum': {
      return spec.options.includes(input) ? ok(input) : fail('목록에서 골라 주세요.');
    }
    case 'string': {
      const text = String(input).trim();
      if (spec.maxLength != null && text.length > spec.maxLength) return fail(`${spec.maxLength}자 이하로 입력해 주세요.`);
      return ok(text);
    }
    case 'url': {
      const text = String(input).trim();
      let url;
      try {
        url = new URL(text);
      } catch {
        return fail('주소 형식이 올바르지 않아요. 복사한 주소 전체를 붙여넣어 주세요.');
      }
      if (url.protocol !== 'https:') return fail('https:// 로 시작하는 주소를 입력해 주세요.');
      if (spec.pattern && !spec.pattern.test(text)) return fail(spec.patternMessage ?? '주소 형식이 올바르지 않아요.');
      return ok(text);
    }
    case 'yearMonth': {
      const match = YEAR_MONTH_PATTERN.exec(String(input).trim());
      const month = match ? Number(match[2]) : 0;
      if (!match || month < 1 || month > 12) return fail('2044-06 처럼 연도-월로 입력해 주세요.');
      return ok(`${match[1]}-${pad2(month)}`);
    }
    case 'date': {
      const match = DATE_PATTERN.exec(String(input).trim());
      if (!match) return fail('2026-10-30 처럼 연도-월-일로 입력해 주세요.');
      const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return fail('없는 날짜예요.');
      return ok(`${match[1]}-${pad2(month)}-${pad2(day)}`);
    }
    default:
      return fail('알 수 없는 입력 형식이에요.');
  }
}

// 시나리오별 연 이율·수익률 { low, base, high } (%) 입력 검사.
// 기준은 꼭 넣고, 낮음·높음을 비우면 기준과 같은 값으로 본다.
const SCENARIO_LABELS = { low: '낮음', base: '기준', high: '높음' };

export function validateScenarioRates(raw, { min = -10, max = 30 } = {}) {
  const spec = { type: 'number', min, max };
  const base = coerceValue(spec, raw?.base);
  if (!base.ok) return { error: `${SCENARIO_LABELS.base}: ${base.error}` };
  const value = { low: base.value, base: base.value, high: base.value };
  for (const key of ['low', 'high']) {
    const checked = coerceValue({ ...spec, nullable: true }, raw?.[key]);
    if (!checked.ok) return { error: `${SCENARIO_LABELS[key]}: ${checked.error}` };
    if (checked.value != null) value[key] = checked.value;
  }
  const ordered = value.low <= value.base && value.base <= value.high;
  return { value, warning: ordered ? null : '낮음 ≤ 기준 ≤ 높음 순서인지 확인해 주세요.' };
}

export function normalizeScenarioRates(raw, fallback = 0) {
  const finite = (n) => typeof n === 'number' && Number.isFinite(n);
  const base = finite(raw?.base) ? raw.base : fallback;
  return {
    low: finite(raw?.low) ? raw.low : base,
    base,
    high: finite(raw?.high) ? raw.high : base,
  };
}

// schema에 정의된 키만 남기고, 형식이 맞지 않는 값은 기본값으로 바꾼다.
export function sanitizeObject(schema, raw) {
  const source = isPlainObject(raw) ? raw : {};
  const result = {};
  for (const [key, spec] of Object.entries(schema)) {
    const checked = Object.hasOwn(source, key) ? coerceValue(spec, source[key]) : null;
    result[key] = checked?.ok ? checked.value : spec.default;
  }
  return result;
}
