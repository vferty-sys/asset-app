// apps-script/Code.gs를 Node에서 가짜 구글 시트로 실행해 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { parseSheetResponse } from '../js/price.js';
import { FakeSheet, load } from './helpers/apps-script-harness.js';

const HEADER = ['티커', '가격', '통화'];

test('doGet: 시세·환율·오류 티커를 요청서 4-2 형식으로 돌려준다', () => {
  const sheet = new FakeSheet('시세', 1, [
    HEADER,
    ['CURRENCY:USDKRW', 1380.5, ''],
    ['krx:005930 ', 61000, 'KRW'],
    ['NASDAQ:QQQ', 512.3, 'USD'],
    ['KRX:123456', '#N/A', '#N/A'],
    ['', '', ''],
    ['CURRENCY:JPYKRW', '#N/A', ''],
    ['NYSE:KO', 0, 'USD'],
  ]);
  const { context } = load([sheet]);
  const output = context.doGet();
  assert.equal(output.mimeType, 'application/json');
  const json = JSON.parse(output.text);
  assert.ok(!Number.isNaN(Date.parse(json.updatedAt)));
  assert.deepEqual(json.fx, { USDKRW: 1380.5 });
  assert.deepEqual(json.prices, {
    'KRX:005930': { price: 61000, currency: 'KRW' },
    'NASDAQ:QQQ': { price: 512.3, currency: 'USD' },
  });
  assert.deepEqual(json.errors, ['KRX:123456', 'CURRENCY:JPYKRW', 'NYSE:KO']);

  // 앱의 응답 검사도 그대로 통과한다
  const parsed = parseSheetResponse(json);
  assert.equal(parsed.fx.USDKRW, 1380.5);
  assert.equal(parsed.prices['KRX:005930'].price, 61000);
});

test('doGet: 제목 줄만 있으면 빈 결과, 시세 탭이 없으면 첫 번째 탭을 읽는다', () => {
  assert.deepEqual(JSON.parse(load([new FakeSheet('시세', 1, [HEADER])]).context.doGet().text).prices, {});
  const first = new FakeSheet('시트1', 1, [HEADER, ['KRX:005930', 61000, 'KRW']]);
  const json = JSON.parse(load([first, new FakeSheet('다른 탭', 2)]).context.doGet().text);
  assert.deepEqual(Object.keys(json.prices), ['KRX:005930']);
});

test('doGet: 코드 실행 중 오류가 나면 error 문구를 돌려준다', () => {
  const { context, spreadsheet } = load([]);
  spreadsheet.getSheets = () => { throw new Error('권한 없음'); };
  assert.deepEqual(JSON.parse(context.doGet().text), { error: '권한 없음' });
});

test('setupSheet: 시세 탭, 제목 줄, 환율 줄, 예시 종목과 수식을 만든다', () => {
  const sheets = [new FakeSheet('시트1', 1)];
  const { context } = load(sheets);
  context.setupSheet();
  const sheet = sheets[0];
  assert.equal(sheet.name, '시세');
  assert.deepEqual(sheet.getRange(1, 1, 4, 1).getValues().flat(), ['티커', 'CURRENCY:USDKRW', 'KRX:005930', 'NASDAQ:QQQ']);
  // 환율은 칸을 가리키거나 "price"를 붙이면 #N/A가 날 수 있어 티커를 수식에 직접 적는다
  assert.equal(sheet.cell(2, 2).formula, '=GOOGLEFINANCE("CURRENCY:USDKRW")');
  assert.equal(sheet.cell(2, 3).formula, '');
  assert.equal(sheet.cell(3, 2).formula, '=GOOGLEFINANCE(A3, "price")');
  assert.equal(sheet.cell(3, 3).formula, '=GOOGLEFINANCE(A3, "currency")');
  assert.equal(sheets[1].name, '시트1');
});

test('setupSheet: 이미 적어 둔 티커는 지우지 않는다', () => {
  const sheet = new FakeSheet('시세', 1, [HEADER, ['NYSE:KO', '', '']]);
  load([sheet]).context.setupSheet();
  assert.equal(sheet.getLastRow(), 2);
  assert.equal(sheet.cell(2, 1).value, 'NYSE:KO');
  assert.equal(sheet.cell(2, 2).formula, '=GOOGLEFINANCE(A2, "price")');
});

test('onEdit: A열에 티커를 적으면 수식을 채우고, 지우면 수식도 지운다', () => {
  const sheet = new FakeSheet('시세', 1, [HEADER]);
  const { context } = load([sheet]);
  sheet.write(5, 1, { value: 'NYSEARCA:SCHD', formula: '' });
  context.onEdit({ range: sheet.getRange(5, 1) });
  assert.equal(sheet.cell(5, 2).formula, '=GOOGLEFINANCE(A5, "price")');
  assert.equal(sheet.cell(5, 3).formula, '=GOOGLEFINANCE(A5, "currency")');

  sheet.write(5, 1, { value: '', formula: '' });
  context.onEdit({ range: sheet.getRange(5, 1) });
  assert.equal(sheet.cell(5, 2).formula, '');
  assert.equal(sheet.cell(5, 3).formula, '');
});

test('setupSheet 다시 실행: 예전 코드가 넣은 환율 수식은 고치고, 직접 고친 수식은 그대로 둔다', () => {
  const sheet = new FakeSheet('시세', 1, [HEADER]);
  sheet.write(2, 1, { value: 'CURRENCY:USDKRW', formula: '' });
  sheet.write(2, 2, { value: '#N/A', formula: '=GOOGLEFINANCE(A2, "price")' });
  sheet.write(2, 3, { value: '#N/A', formula: '=GOOGLEFINANCE(A2, "currency")' });
  sheet.write(3, 1, { value: 'CURRENCY:JPYKRW', formula: '' });
  sheet.write(3, 2, { value: 9.1, formula: '=IFERROR(GOOGLEFINANCE("CURRENCY:JPYKRW"), 9)' });
  sheet.write(4, 1, { value: 'NYSE:KO', formula: '' });
  sheet.write(4, 2, { value: 70, formula: '=GOOGLEFINANCE(A4,"price")' });
  load([sheet]).context.setupSheet();
  assert.equal(sheet.cell(2, 2).formula, '=GOOGLEFINANCE("CURRENCY:USDKRW")');
  assert.equal(sheet.cell(2, 3).formula, '', '환율 줄의 통화 칸은 비운다');
  assert.equal(sheet.cell(3, 2).formula, '=IFERROR(GOOGLEFINANCE("CURRENCY:JPYKRW"), 9)');
  assert.equal(sheet.cell(4, 2).formula, '=GOOGLEFINANCE(A4, "price")');
});

test('onEdit: 티커의 띄어쓰기·소문자를 고쳐 적고, 환율 줄로 바꾸면 수식도 바꾼다', () => {
  const sheet = new FakeSheet('시세', 1, [HEADER]);
  const { context } = load([sheet]);
  sheet.write(3, 1, { value: ' nyse: fcx ', formula: '' });
  context.onEdit({ range: sheet.getRange(3, 1) });
  assert.equal(sheet.cell(3, 1).value, 'NYSE:FCX');
  assert.equal(sheet.cell(3, 2).formula, '=GOOGLEFINANCE(A3, "price")');
  assert.equal(sheet.cell(3, 3).formula, '=GOOGLEFINANCE(A3, "currency")');

  sheet.write(3, 1, { value: 'currency: usdkrw', formula: '' });
  context.onEdit({ range: sheet.getRange(3, 1) });
  assert.equal(sheet.cell(3, 1).value, 'CURRENCY:USDKRW');
  assert.equal(sheet.cell(3, 2).formula, '=GOOGLEFINANCE("CURRENCY:USDKRW")');
  assert.equal(sheet.cell(3, 3).formula, '');

  sheet.write(3, 1, { value: 'CURRENCY:USDJPY', formula: '' });
  context.onEdit({ range: sheet.getRange(3, 1) });
  assert.equal(sheet.cell(3, 2).formula, '=GOOGLEFINANCE("CURRENCY:USDJPY")');

  sheet.write(3, 1, { value: 'NASDAQ:QQQ', formula: '' });
  context.onEdit({ range: sheet.getRange(3, 1) });
  assert.equal(sheet.cell(3, 2).formula, '=GOOGLEFINANCE(A3, "price")');

  // 숫자로 적힌 칸은 그대로 둔다 (고쳐 적지 않음)
  sheet.write(4, 1, { value: 5930, formula: '' });
  context.onEdit({ range: sheet.getRange(4, 1) });
  assert.equal(sheet.cell(4, 1).value, 5930);
});

test('onEdit: 여러 줄 붙여넣기는 줄마다, 제목 줄·다른 열·다른 탭은 건드리지 않는다', () => {
  const sheet = new FakeSheet('시세', 1, [HEADER]);
  const other = new FakeSheet('메모', 2);
  const { context } = load([sheet, other]);
  sheet.write(2, 1, { value: 'KRX:005930', formula: '' });
  sheet.write(3, 1, { value: 'KRX:000660', formula: '' });
  context.onEdit({ range: sheet.getRange(1, 1, 3, 1) });
  assert.equal(sheet.cell(1, 2).value, '가격');
  assert.equal(sheet.cell(1, 2).formula, '');
  assert.equal(sheet.cell(3, 2).formula, '=GOOGLEFINANCE(A3, "price")');

  sheet.write(4, 2, { value: '메모', formula: '' });
  context.onEdit({ range: sheet.getRange(4, 2) });
  assert.equal(sheet.cell(4, 2).formula, '');

  other.write(2, 1, { value: 'KRX:005930', formula: '' });
  context.onEdit({ range: other.getRange(2, 1) });
  assert.equal(other.cell(2, 2).formula, '');
});

// ── 기기 연동 ─────────────────────────────────────────
const post = (context, body) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(body) } }).text);
const info = (context) => JSON.parse(context.doGet({ parameter: { action: 'sync-info' } }).text);
const payloadOf = (size = 120) => ({ iv: randomBytes(12).toString('base64'), zip: 'gzip', data: randomBytes(size).toString('base64') });
const SALT = randomBytes(16).toString('base64');

function setupSync() {
  const sheets = [new FakeSheet('시세', 1, [HEADER, ['NASDAQ:QQQ', 512.3, 'USD']])];
  const { context } = load(sheets);
  const first = payloadOf();
  const result = post(context, { action: 'sync-setup', salt: SALT, hint: '첫 강아지', auth: 'secret-auth', device: '노트북', payload: first });
  return { context, sheets, first, result };
}

test('기기 연동: 켜기 전 상태, 처음 켜면 숨긴 탭에 솔트·힌트·확인값과 첫 데이터를 저장', () => {
  const sheets = [new FakeSheet('시세', 1, [HEADER])];
  assert.deepEqual(info(load(sheets).context), { sync: 1, exists: false });

  const { context, sheets: all, result } = setupSync();
  assert.equal(result.ok, true);
  assert.equal(result.revision, 1);
  const tab = all.find((sheet) => sheet.name === '앱 데이터');
  assert.ok(tab.hidden, '앱 데이터 탭은 숨긴다');
  const state = info(context);
  assert.deepEqual({ ...state, savedAt: typeof state.savedAt }, { sync: 1, exists: true, salt: SALT, hint: '첫 강아지', revision: 1, savedAt: 'string', device: '노트북' });
  // 비밀번호로 만든 auth는 그대로 저장하지 않고 SHA-256 확인값만 둔다
  const stored = [...tab.cells.values()].map((cell) => String(cell.value));
  assert.ok(!stored.some((value) => value.includes('secret-auth')));
  // 이미 켜져 있으면 다시 켜지 않는다 (덮어쓰기 방지)
  assert.equal(post(context, { action: 'sync-setup', salt: SALT, hint: '', auth: 'other', device: 'x', payload: payloadOf() }).error, 'exists');
  // 시세 응답은 그대로
  assert.deepEqual(Object.keys(JSON.parse(context.doGet().text).prices), ['NASDAQ:QQQ']);
});

test('기기 연동: 비밀번호 확인값이 맞아야 불러오고, 데이터는 보낸 그대로 돌려준다', () => {
  const { context, first } = setupSync();
  assert.equal(post(context, { action: 'sync-load', auth: 'wrong' }).error, 'auth');
  assert.equal(post(context, { action: 'sync-load' }).error, 'auth');
  const loaded = post(context, { action: 'sync-load', auth: 'secret-auth' });
  assert.deepEqual([loaded.revision, loaded.iv, loaded.zip, loaded.data, loaded.device], [1, first.iv, 'gzip', first.data, '노트북']);
});

test('기기 연동: 마지막으로 받은 번호가 같을 때만 저장하고, 다르면 다른 기기가 먼저 저장했다고 알려준다', () => {
  const { context } = setupSync();
  const saved = post(context, { action: 'sync-save', auth: 'secret-auth', baseRevision: 1, device: '회사 PC', payload: payloadOf() });
  assert.deepEqual([saved.ok, saved.revision], [true, 2]);
  // 노트북은 아직 1번을 들고 있음 → 덮어쓰지 않음
  const conflict = post(context, { action: 'sync-save', auth: 'secret-auth', baseRevision: 1, device: '노트북', payload: payloadOf() });
  assert.deepEqual([conflict.conflict, conflict.revision, conflict.device], [true, 2, '회사 PC']);
  assert.equal(info(context).revision, 2);
  // 비밀번호가 틀리면 저장하지 않음
  assert.equal(post(context, { action: 'sync-save', auth: 'nope', baseRevision: 2, device: 'x', payload: payloadOf() }).error, 'auth');
  // 형식이 틀린 데이터는 저장하지 않음
  assert.equal(post(context, { action: 'sync-save', auth: 'secret-auth', baseRevision: 2, device: 'x', payload: { iv: '!!', data: '<script>' } }).error, 'format');
});

test('기기 연동: 큰 데이터는 여러 칸에 나눠 저장하고 그대로 합쳐 돌려준다', () => {
  const { context } = setupSync();
  const big = payloadOf(90_000); // base64 120,000자 → 3칸
  post(context, { action: 'sync-save', auth: 'secret-auth', baseRevision: 1, device: '노트북', payload: big });
  assert.equal(post(context, { action: 'sync-load', auth: 'secret-auth' }).data, big.data);
});

test('기기 연동: 최신 1개 + 예전 기록 10개를 남기고, 예전 번호로 불러올 수 있다', () => {
  const { context } = setupSync();
  const payloads = {};
  for (let revision = 2; revision <= 15; revision += 1) {
    payloads[revision] = payloadOf();
    post(context, { action: 'sync-save', auth: 'secret-auth', baseRevision: revision - 1, device: revision % 2 ? '노트북' : '회사 PC', payload: payloads[revision] });
  }
  const history = post(context, { action: 'sync-history', auth: 'secret-auth' });
  assert.deepEqual(history.records.map((record) => record.revision), [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
  assert.equal(post(context, { action: 'sync-load', auth: 'secret-auth', revision: 9 }).data, payloads[9].data);
  assert.equal(post(context, { action: 'sync-load', auth: 'secret-auth', revision: 2 }).error, 'not-found');
  assert.equal(post(context, { action: 'sync-history', auth: 'nope' }).error, 'auth');
});

test('기기 연동: 이상한 요청은 오류로 답한다', () => {
  const { context } = setupSync();
  assert.equal(post(context, { action: 'drop-table' }).error, 'action');
  assert.equal(JSON.parse(context.doPost({ postData: { contents: '{not json' } }).text).error, 'server');
  const sheets = [new FakeSheet('시세', 1, [HEADER])];
  assert.equal(post(load(sheets).context, { action: 'sync-load', auth: 'x' }).error, 'not-setup');
});
