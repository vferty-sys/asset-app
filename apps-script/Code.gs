/**
 * 내 자산 한눈에 — 구글 시트 시세 연동 코드 (Apps Script)
 *
 * 이 코드는 시트에 적힌 티커의 현재가·통화와 달러 환율을 앱이 읽을 수 있는 JSON으로 돌려줍니다.
 * 시트에는 티커와 시세만 두세요. 수량·평단가·금액 같은 개인 정보는 절대 적지 마세요.
 * 이 코드는 시트를 읽기만 하고, 어떤 정보도 다른 곳으로 보내지 않습니다.
 *
 * ── 시트 구조 ('시세' 탭, 없으면 첫 번째 탭 / 1행은 제목 줄) ───────────────
 *
 *         A                  B                                     C
 *    1    티커               가격                                  통화
 *    2    CURRENCY:USDKRW    =GOOGLEFINANCE("CURRENCY:USDKRW")     (비워 둠)        ← 달러 환율 (지우지 마세요)
 *    3    KRX:005930         =GOOGLEFINANCE(A3, "price")           =GOOGLEFINANCE(A3, "currency")
 *    4    NASDAQ:QQQ         =GOOGLEFINANCE(A4, "price")           =GOOGLEFINANCE(A4, "currency")
 *    …    (종목마다 한 줄씩)
 *
 *  - A열: 앱에 입력한 티커와 똑같이, 띄어쓰기 없이 적어요. 예) KRX:005930, KOSDAQ:247540, NASDAQ:QQQ, NYSEARCA:SCHD
 *    'NYSE: FCX'처럼 띄어쓰기가 들어가거나 소문자로 적으면 'NYSE:FCX'로 고쳐 적어요(onEdit).
 *  - B열·C열: 위 수식. A열에 티커를 적으면 자동으로 채워져요(onEdit). 안 채워지면 위 칸을 복사해 붙여넣으세요.
 *  - "CURRENCY:"로 시작하는 줄은 환율로 처리해요. CURRENCY:USDKRW → fx.USDKRW
 *    환율은 칸을 가리키거나 "price"를 붙이면 #N/A가 나는 경우가 있어 =GOOGLEFINANCE("CURRENCY:USDKRW")처럼 직접 적어요.
 *    통화(C열)는 환율 줄에서는 쓰지 않으니 비워 둬요.
 *  - B열 수식을 직접 고쳐 두었다면 그 수식은 건드리지 않아요. (이 코드가 넣은 수식만 바꿔요)
 *
 * ── 처음 한 번: setupSheet 실행 ──────────────────────────────────────
 *  편집기 위쪽 함수 목록에서 setupSheet를 고르고 [실행]을 누르면
 *  '시세' 탭, 제목 줄, 환율 줄, 예시 종목 두 개가 만들어져요. (이미 있는 내용은 지우지 않아요)
 *  예전 코드로 만든 시트에서 환율(B2)이 #N/A면, 이 코드로 바꾼 뒤 setupSheet를 한 번 더 실행하면 고쳐져요.
 *
 * ── 웹 앱으로 배포 ─────────────────────────────────────────────
 *  [배포] → [새 배포] → 유형: 웹 앱
 *  다음 사용자 인증 정보로 실행: 나 / 액세스 권한이 있는 사용자: 모든 사용자 → [배포]
 *  나오는 주소(https://script.google.com/macros/s/…/exec)를 앱 설정의 '시트 웹 앱 주소'에 붙여넣어요.
 *  코드를 고친 뒤에는 [배포] → [배포 관리] → 수정(연필) → 버전: 새 버전 → [배포] (주소는 그대로예요)
 *
 * ── 응답 형식 ───────────────────────────────────────────────
 *  {
 *    "updatedAt": "2026-10-30T01:00:00.000Z",
 *    "fx": { "USDKRW": 1380.5 },
 *    "prices": {
 *      "KRX:005930": { "price": 61000, "currency": "KRW" },
 *      "NASDAQ:QQQ": { "price": 512.3, "currency": "USD" }
 *    },
 *    "errors": ["KRX:123456"]      ← 가격을 받지 못한 티커 (#N/A 등)
 *  }
 */

const SHEET_NAME = '시세';
const HEADER_ROWS = 1;
const CURRENCY_PREFIX = 'CURRENCY:';

// 앱이 시세를 요청할 때 실행된다 (웹 앱 GET 요청).
function doGet() {
  let result;
  try {
    result = readQuotes_();
  } catch (error) {
    result = { error: String((error && error.message) || error) };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

// 시트를 열어 둔 상태에서 A열에 티커를 적으면 B열·C열 수식을 채운다 (단순 트리거).
function onEdit(e) {
  const range = e && e.range;
  if (!range || range.getColumn() !== 1) return;
  const sheet = range.getSheet();
  if (sheet.getSheetId() !== getQuoteSheet_().getSheetId()) return;
  const firstRow = Math.max(range.getRow(), HEADER_ROWS + 1);
  for (let row = firstRow; row <= range.getLastRow(); row += 1) fillFormulas_(sheet, row);
}

// 처음 한 번 실행: '시세' 탭과 제목 줄, 환율 줄, 예시 종목을 만든다.
function setupSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME, 0);
  sheet.getRange(1, 1, 1, 3).setValues([['티커', '가격', '통화']]).setFontWeight('bold');
  sheet.setFrozenRows(HEADER_ROWS);
  if (sheet.getLastRow() <= HEADER_ROWS) {
    sheet.getRange(HEADER_ROWS + 1, 1, 3, 1).setValues([['CURRENCY:USDKRW'], ['KRX:005930'], ['NASDAQ:QQQ']]);
  }
  for (let row = HEADER_ROWS + 1; row <= sheet.getLastRow(); row += 1) fillFormulas_(sheet, row);
  sheet.autoResizeColumns(1, 3);
}

function getQuoteSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  return spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.getSheets()[0];
}

function normalizeTicker_(value) {
  return String(value == null ? '' : value).trim().toUpperCase().replace(/\s+/g, '');
}

// 가격 수식. 환율은 칸을 가리키거나 "price"를 붙이면 #N/A가 나는 경우가 있어 =GOOGLEFINANCE("CURRENCY:USDKRW")처럼 적는다.
function priceFormula_(ticker, row) {
  if (/^CURRENCY:[A-Z]+$/.test(ticker)) return `=GOOGLEFINANCE("${ticker}")`;
  if (ticker.indexOf(CURRENCY_PREFIX) === 0) return `=GOOGLEFINANCE(A${row})`;
  return `=GOOGLEFINANCE(A${row}, "price")`;
}

// 이 코드가 넣은 가격 수식인지 (예전 버전이 환율 줄에 넣던 =GOOGLEFINANCE(A2, "price") 포함). 직접 고친 수식은 그대로 둔다.
function isAutoPriceFormula_(formula) {
  return !formula || /^=GOOGLEFINANCE\(\s*(A\d+\s*(,\s*"price"\s*)?|"CURRENCY:[A-Z]+"\s*)\)$/i.test(formula);
}

function fillFormulas_(sheet, row) {
  const tickerCell = sheet.getRange(row, 1);
  const raw = tickerCell.getValue();
  const ticker = normalizeTicker_(raw);
  const priceCell = sheet.getRange(row, 2);
  const currencyCell = sheet.getRange(row, 3);
  if (!ticker) {
    priceCell.clearContent();
    currencyCell.clearContent();
    return;
  }
  // 'NYSE: FCX'처럼 띄어쓰기가 있으면 구글 금융이 #N/A를 내서, 띄어쓰기를 빼고 대문자로 고쳐 적는다
  if (typeof raw === 'string' && raw !== ticker) tickerCell.setValue(ticker);
  if (isAutoPriceFormula_(priceCell.getFormula())) priceCell.setFormula(priceFormula_(ticker, row));
  if (ticker.indexOf(CURRENCY_PREFIX) === 0) currencyCell.clearContent();
  else if (!currencyCell.getFormula()) currencyCell.setFormula(`=GOOGLEFINANCE(A${row}, "currency")`);
}

function readQuotes_() {
  const sheet = getQuoteSheet_();
  const result = { updatedAt: new Date().toISOString(), fx: {}, prices: {}, errors: [] };
  const lastRow = sheet.getLastRow();
  if (lastRow <= HEADER_ROWS) return result;

  const rows = sheet.getRange(HEADER_ROWS + 1, 1, lastRow - HEADER_ROWS, 3).getValues();
  rows.forEach((row) => {
    const ticker = normalizeTicker_(row[0]);
    if (!ticker) return;
    const price = row[1];
    // #N/A 같은 오류 칸은 문자열로 읽힌다.
    const valid = typeof price === 'number' && isFinite(price) && price > 0;
    if (!valid) {
      if (result.errors.indexOf(ticker) === -1) result.errors.push(ticker);
      return;
    }
    if (ticker.indexOf(CURRENCY_PREFIX) === 0) {
      result.fx[ticker.slice(CURRENCY_PREFIX.length)] = price;
      return;
    }
    const currency = typeof row[2] === 'string' ? row[2].trim().toUpperCase() : '';
    result.prices[ticker] = { price, currency: currency || null };
  });
  return result;
}
