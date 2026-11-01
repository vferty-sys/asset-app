// apps-script/Code.gs를 Node에서 가짜 구글 시트로 실행하는 도구 (Code.gs 테스트와 기기 연동 테스트가 함께 쓴다)
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const CODE = readFileSync(new URL('../../apps-script/Code.gs', import.meta.url), 'utf8');

export class FakeRange {
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

  setValue(value) {
    this.sheet.write(this.row, this.column, { value, formula: '' });
    return this;
  }

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

export class FakeSheet {
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

  getLastColumn() {
    return Math.max(0, ...[...this.cells.keys()].map((key) => Number(key.split(',')[1])));
  }

  // row 위치에 빈 줄을 넣는다 (아래 줄은 한 칸씩 내려감)
  insertRowBefore(row) {
    this.shiftRows(row, 1);
  }

  deleteRows(row, count) {
    for (const key of [...this.cells.keys()]) {
      const r = Number(key.split(',')[0]);
      if (r >= row && r < row + count) this.cells.delete(key);
    }
    this.shiftRows(row + count, -count);
  }

  shiftRows(fromRow, by) {
    const moved = [...this.cells.entries()].filter(([key]) => Number(key.split(',')[0]) >= fromRow);
    moved.forEach(([key]) => this.cells.delete(key));
    for (const [key, cell] of moved) {
      const [r, c] = key.split(',').map(Number);
      this.cells.set(`${r + by},${c}`, cell);
    }
  }

  clear() { this.cells.clear(); }

  hideSheet() { this.hidden = true; }

  getRange(row, column, numRows, numColumns) { return new FakeRange(this, row, column, numRows, numColumns); }

  getSheetId() { return this.id; }

  getName() { return this.name; }

  setFrozenRows() {}

  autoResizeColumns() {}
}

export function load(sheets) {
  const spreadsheet = {
    sheets,
    getSheetByName: (name) => sheets.find((sheet) => sheet.name === name) ?? null,
    getSheets: () => sheets,
    insertSheet(name, index = sheets.length) {
      const sheet = new FakeSheet(name, 100 + sheets.length);
      sheets.splice(index, 0, sheet);
      return sheet;
    },
  };
  const context = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (algorithm, value) => [...createHash(algorithm).update(String(value), 'utf8').digest()],
      base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ setMimeType: (mimeType) => ({ text, mimeType }) }),
    },
  });
  vm.runInContext(CODE, context);
  return { context, spreadsheet };
}

// 웹 앱 주소로 오는 요청을 Code.gs의 doGet·doPost로 보내는 가짜 fetch (브라우저 fetch와 같은 모양으로 답한다)
export function fakeWebAppFetch(context) {
  return async (url, init = {}) => {
    const parsed = new URL(url);
    const output = init.method === 'POST'
      ? context.doPost({ postData: { contents: init.body } })
      : context.doGet({ parameter: Object.fromEntries(parsed.searchParams) });
    return { ok: true, status: 200, text: async () => output.text };
  };
}
