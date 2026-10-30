// apps-script/Code.gs를 Node에서 가짜 구글 시트로 실행해 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseSheetResponse } from '../js/price.js';

const CODE = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

class FakeRange {
  constructor(sheet, row, column, numRows = 1, numColumns = 1) {
    Object.assign(this, { sheet, row, column, numRows, numColumns });
  }

  forEachCell(fn) {
    for (let r = 0; r < this.numRows; r += 1) {
      for (let c = 0; c < this.numColumns; c += 1) fn(this.row + r, this.column + c, r, c);
    }
  }

  getValues() {
    return Array.from({ length: this.numRows }, (_, r) => Array.from({ length: this.numColumns }, (__, c) => this.sheet.cell(this.row + r, this.column + c).value));
  }

  getValue() { return this.sheet.cell(this.row, this.column).value; }

  setValues(values) {
    this.forEachCell((row, column, r, c) => this.sheet.write(row, column, { value: values[r][c], formula: '' }));
    return this;
  }

  getFormula() { return this.sheet.cell(this.row, this.column).formula; }

  setFormula(formula) {
    this.sheet.write(this.row, this.column, { value: this.getValue(), formula });
    return this;
  }

  clearContent() {
    this.forEachCell((row, column) => this.sheet.write(row, column, { value: '', formula: '' }));
    return this;
  }

  setFontWeight() { return this; }

  getRow() { return this.row; }

  getColumn() { return this.column; }

  getLastRow() { return this.row + this.numRows - 1; }

  getSheet() { return this.sheet; }
}

class FakeSheet {
  constructor(name, id, rows = []) {
    this.name = name;
    this.id = id;
    this.cells = new Map();
    rows.forEach((line, r) => line.forEach((value, c) => this.write(r + 1, c + 1, { value, formula: '' })));
  }

  cell(row, column) { return this.cells.get(`${row},${column}`) ?? { value: '', formula: '' }; }

  write(row, column, cell) {
    const key = `${row},${column}`;
    if (cell.value === '' && !cell.formula) this.cells.delete(key);
    else this.cells.set(key, cell);
  }

  getLastRow() {
    return Math.max(0, ...[...this.cells.keys()].map((key) => Number(key.split(',')[0])));
  }

  getRange(row, column, numRows, numColumns) { return new FakeRange(this, row, column, numRows, numColumns); }

  getSheetId() { return this.id; }

  getName() { return this.name; }

  setFrozenRows() {}

  autoResizeColumns() {}
}

function load(sheets) {
  const spreadsheet = {
    sheets,
    getSheetByName: (name) => sheets.find((sheet) => sheet.name === name) ?? null,
    getSheets: () => sheets,
    insertSheet(name, index) {
      const sheet = new FakeSheet(name, 100 + sheets.length);
      sheets.splice(index, 0, sheet);
      return sheet;
    },
  };
  const context = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ setMimeType: (mimeType) => ({ text, mimeType }) }),
    },
  });
  vm.runInContext(CODE, context);
  return { context, spreadsheet };
}

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
  assert.equal(sheet.cell(2, 2).formula, '=GOOGLEFINANCE(A2, "price")');
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
