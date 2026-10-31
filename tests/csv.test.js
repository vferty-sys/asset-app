import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOLDING_CSV_TEMPLATE, parseDelimited, parseHoldingsCsv, parseMixCell } from '../js/calc/csv.js';
import { validateHolding } from '../js/holding.js';

test('쉼표 구분: 따옴표 안의 쉼표·줄바꿈·"" 처리, 빈 줄 무시', () => {
  const text = '이름,메모\r\n"삼성전자, 우선주","줄1\n줄2"\n\n"따옴표 ""안""",끝\n';
  assert.deepEqual(parseDelimited(text), [
    { line: 1, cells: ['이름', '메모'] },
    { line: 2, cells: ['삼성전자, 우선주', '줄1\n줄2'] },
    { line: 5, cells: ['따옴표 "안"', '끝'] },
  ]);
});

test('탭 구분(엑셀·구글 시트 복사)도 자동으로 알아본다', () => {
  const text = '종목명\t수량\n삼성전자\t1,000\n';
  assert.deepEqual(parseDelimited(text).map((row) => row.cells), [['종목명', '수량'], ['삼성전자', '1,000']]);
});

test('국가·섹터 칸: 하나면 100%, "이름:비율;이름:비율"은 나눠서', () => {
  assert.deepEqual(parseMixCell('미국'), [{ name: '미국', percent: '100' }]);
  assert.deepEqual(parseMixCell('기술:50; 통신=15 | 소비재 : 35%'), [
    { name: '기술', percent: '50' }, { name: '통신', percent: '15' }, { name: '소비재', percent: '35' },
  ]);
  assert.deepEqual(parseMixCell('미국;한국'), [{ name: '미국', percent: '' }, { name: '한국', percent: '' }]);
});

test('예시 양식은 오류 없이 2개 종목으로 읽힌다', () => {
  const { rows, error } = parseHoldingsCsv(HOLDING_CSV_TEMPLATE);
  assert.equal(error, undefined);
  assert.deepEqual(rows.map((row) => row.status), ['add', 'add']);
  const [samsung, qqq] = rows.map((row) => row.holding);
  assert.equal(samsung.quantity, 10);
  assert.deepEqual(samsung.countryMix, { 한국: 100 });
  assert.equal(qqq.type, 'etf');
  assert.equal(qqq.currency, 'USD');
  assert.deepEqual(qqq.sectorMix, { 기술: 50, 통신: 15, 소비재: 35 });
});

test('필수 열만 있어도 되고, 통화·국가는 티커로 짐작한다', () => {
  const { rows } = parseHoldingsCsv('종목명,티커,수량,평단가\n애플,NASDAQ:AAPL,"1,000",$180.5\n');
  const holding = rows[0].holding;
  assert.equal(rows[0].status, 'add');
  assert.equal(holding.currency, 'USD');
  assert.equal(holding.quantity, 1000);
  assert.equal(holding.avgPrice, 180.5);
  assert.deepEqual(holding.countryMix, { 미국: 100 });
  assert.deepEqual(holding.sectorMix, { 기타: 100 });
  assert.equal(holding.account, '일반');
  assert.equal(holding.assetClass, '기타');
});

test('영어 열 이름과 괄호 설명이 붙은 열 이름도 알아본다', () => {
  const { rows } = parseHoldingsCsv('Name,Ticker,Quantity,평단가(원),계좌\n삼성전자,KRX:005930,5,60000,ISA\n');
  assert.equal(rows[0].status, 'add');
  assert.equal(rows[0].holding.account, 'ISA');
});

test('꼭 필요한 열이 없거나 내용이 없으면 전체 오류', () => {
  assert.match(parseHoldingsCsv('종목명,티커\n삼성전자,KRX:005930').error, /수량, 평단가/);
  assert.match(parseHoldingsCsv('종목명,티커,수량,평단가\n').error, /한 줄 이상/);
  assert.match(parseHoldingsCsv('   \n').error, /없어요/);
});

test('줄별 오류는 줄 번호와 함께 알려준다', () => {
  const text = [
    '종목명,티커,통화,수량,평단가,계좌,종류',
    '삼성전자,005930,KRW,10,61000,일반,주식',
    '이상한종목,ABC:XYZ,엔화,1,100,일반,주식',
    '없는계좌,KRX:000660,KRW,1,100,연금,주식',
    '이상한종류,KRX:035420,KRW,1,100,일반,펀드',
  ].join('\n');
  const { rows } = parseHoldingsCsv(text);
  assert.deepEqual(rows.map((row) => [row.line, row.status]), [[2, 'error'], [3, 'error'], [4, 'error'], [5, 'error']]);
  assert.match(rows[0].messages.join(), /KRX:005930/);
  assert.match(rows[1].messages.join(), /KRW 또는 USD/);
  assert.match(rows[2].messages.join(), /계좌는/);
  assert.match(rows[3].messages.join(), /종류는/);
});

test('개별 주식에 국가를 여러 개 적으면 ETF로 적으라고 안내한다', () => {
  const { rows } = parseHoldingsCsv('종목명,티커,수량,평단가,국가\n삼성전자,KRX:005930,1,100,한국:50;미국:50\n');
  assert.equal(rows[0].status, 'error');
  assert.match(rows[0].messages.join(), /ETF/);
});

test('ETF 비율 합계가 100이 아니면 등록은 되고 경고를 보여준다', () => {
  const { rows } = parseHoldingsCsv('종목명,티커,종류,수량,평단가,섹터\nQQQ,NASDAQ:QQQ,ETF,1,450,기술:50;통신:15\n');
  assert.equal(rows[0].status, 'add');
  assert.match(rows[0].messages.join(), /65%/);
});

test('붙여넣은 내용 안에서 같은 종목·계좌가 겹치면 뒤쪽 줄은 오류', () => {
  const text = '종목명,티커,수량,평단가\n삼성전자,KRX:005930,1,100\n삼성전자,krx:005930,2,100\n';
  const { rows } = parseHoldingsCsv(text);
  assert.deepEqual(rows.map((row) => row.status), ['add', 'error']);
  assert.match(rows[1].messages[0], /2번째 줄/);
});

test('이미 있는 종목: 기본은 건너뛰고, 덮어쓰기를 켜면 붙여넣은 열만 바꾼다', () => {
  const existing = validateHolding({
    name: '삼성전자', ticker: 'KRX:005930', type: 'stock', currency: 'KRW', quantity: '10', avgPrice: '60000',
    manualPrice: '70000', account: '일반', assetClass: '성장주', countryRows: [{ name: '한국', percent: 100 }],
    sectorRows: [{ name: '기술', percent: 100 }], dividendPerShare: '', memo: '오래 보유',
  }).value;
  const text = '종목명,티커,수량,평단가\n삼성전자,KRX:005930,15,62000\n';

  const skipped = parseHoldingsCsv(text, { existing: [existing] });
  assert.equal(skipped.rows[0].status, 'skip');

  const updated = parseHoldingsCsv(text, { existing: [existing], overwrite: true });
  assert.equal(updated.rows[0].status, 'update');
  assert.deepEqual(updated.rows[0].holding, { ...existing, quantity: 15, avgPrice: 62000 });
});

test('미국 주식 소수점 수량은 설정을 따른다', () => {
  const text = '종목명,티커,수량,평단가\nQQQ,NASDAQ:QQQ,0.5,450\n';
  assert.equal(parseHoldingsCsv(text).rows[0].status, 'error');
  assert.equal(parseHoldingsCsv(text, { allowFractionalUS: true }).rows[0].status, 'add');
});

test('ETF 분산 정도 열(선택): 이름으로 적고, 비우면 종목명으로 짐작한다', () => {
  const text = [
    '종목명,티커,종류,ETF 분산,수량,평단가',
    '2차전지 액티브,KRX:111111,ETF,시장 전체형,1,10000',
    'KODEX 200,KRX:069500,ETF,,1,30000',
    '미국 반도체,KRX:222222,ETF,집중,1,10000',
    '삼성전자,KRX:005930,주식,시장 전체형,1,60000',
  ].join('\n');
  const { rows } = parseHoldingsCsv(text);
  assert.deepEqual(rows.map((row) => row.holding.etfSpread), ['market', 'market', 'single', null]);
});
