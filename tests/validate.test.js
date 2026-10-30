import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumberInput, coerceValue, sanitizeObject } from '../js/validate.js';

test('parseNumberInput: 쉼표와 공백을 허용하고, 빈 값은 null, 이상한 값은 NaN', () => {
  assert.equal(parseNumberInput('1,234.5'), 1234.5);
  assert.equal(parseNumberInput(' 12 '), 12);
  assert.equal(parseNumberInput('-3'), -3);
  assert.equal(parseNumberInput('.5'), 0.5);
  assert.equal(parseNumberInput(7), 7);
  assert.equal(parseNumberInput(''), null);
  assert.equal(parseNumberInput(null), null);
  assert.ok(Number.isNaN(parseNumberInput('abc')));
  assert.ok(Number.isNaN(parseNumberInput('1e5')));
  assert.ok(Number.isNaN(parseNumberInput('1.2.3')));
  assert.ok(Number.isNaN(parseNumberInput(Infinity)));
});

test('coerceValue number: 범위와 정수 검사', () => {
  const spec = { type: 'number', min: 0, max: 100 };
  assert.deepEqual(coerceValue(spec, '2.5'), { ok: true, value: 2.5 });
  assert.equal(coerceValue(spec, '101').ok, false);
  assert.equal(coerceValue(spec, '-1').ok, false);
  assert.equal(coerceValue(spec, '숫자 아님').ok, false);
  assert.equal(coerceValue(spec, '').ok, false);
  assert.match(coerceValue(spec, '101').error, /0 ~ 100/);

  const positive = { type: 'number', exclusiveMin: 0 };
  assert.equal(coerceValue(positive, '0').ok, false);
  assert.match(coerceValue(positive, '0').error, /0보다 큰/);
  assert.deepEqual(coerceValue(positive, '0.01'), { ok: true, value: 0.01 });
  assert.equal(coerceValue({ type: 'enum', options: ['a'] }, '').error, '목록에서 골라 주세요.');

  const integer = { type: 'integer', min: 1900, max: 2100 };
  assert.deepEqual(coerceValue(integer, '1980'), { ok: true, value: 1980 });
  assert.equal(coerceValue(integer, '1980.5').ok, false);
});

test('coerceValue: nullable이면 빈 값을 null로 받는다', () => {
  assert.deepEqual(coerceValue({ type: 'number', nullable: true }, ''), { ok: true, value: null });
  assert.deepEqual(coerceValue({ type: 'yearMonth', nullable: true }, null), { ok: true, value: null });
});

test('coerceValue boolean / enum', () => {
  assert.deepEqual(coerceValue({ type: 'boolean' }, 'true'), { ok: true, value: true });
  assert.deepEqual(coerceValue({ type: 'boolean' }, false), { ok: true, value: false });
  assert.equal(coerceValue({ type: 'boolean' }, 'yes').ok, false);
  const theme = { type: 'enum', options: ['system', 'light', 'dark'] };
  assert.deepEqual(coerceValue(theme, 'dark'), { ok: true, value: 'dark' });
  assert.equal(coerceValue(theme, 'blue').ok, false);
});

test('coerceValue url: https만 허용, 빈 값은 빈 문자열', () => {
  const spec = { type: 'url' };
  assert.deepEqual(coerceValue(spec, ' https://script.google.com/macros/s/abc/exec '), {
    ok: true, value: 'https://script.google.com/macros/s/abc/exec',
  });
  assert.deepEqual(coerceValue(spec, ''), { ok: true, value: '' });
  assert.equal(coerceValue(spec, 'http://example.com').ok, false);
  assert.equal(coerceValue(spec, '주소 아님').ok, false);
});

test('coerceValue yearMonth / date: 형식을 맞추고 없는 날짜는 거부', () => {
  assert.deepEqual(coerceValue({ type: 'yearMonth' }, '2044-6'), { ok: true, value: '2044-06' });
  assert.deepEqual(coerceValue({ type: 'yearMonth' }, '2044.06'), { ok: true, value: '2044-06' });
  assert.equal(coerceValue({ type: 'yearMonth' }, '2044-13').ok, false);
  assert.deepEqual(coerceValue({ type: 'date' }, '2026.1.5'), { ok: true, value: '2026-01-05' });
  assert.equal(coerceValue({ type: 'date' }, '2026-02-30').ok, false);
});

test('sanitizeObject: 정의된 키만 남기고 잘못된 값은 기본값으로', () => {
  const schema = {
    rate: { type: 'number', min: 0, max: 10, default: 2.5 },
    theme: { type: 'enum', options: ['light', 'dark'], default: 'light' },
    year: { type: 'integer', nullable: true, default: null },
  };
  assert.deepEqual(sanitizeObject(schema, { rate: 99, theme: 'dark', extra: 1 }), { rate: 2.5, theme: 'dark', year: null });
  assert.deepEqual(sanitizeObject(schema, null), { rate: 2.5, theme: 'light', year: null });
  assert.deepEqual(sanitizeObject(schema, { year: 1980 }), { rate: 2.5, theme: 'light', year: 1980 });
});
