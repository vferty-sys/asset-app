/**
 * 내 자산 한눈에 — 구글 시트 시세 연동 코드 (Apps Script)
 *
 * 이 코드는 시트에 적힌 티커의 현재가·통화와 달러 환율을 앱이 읽을 수 있는 JSON으로 돌려줍니다.
 * 앱이 시세를 받을 때 보유 종목의 티커(종목 코드)를 함께 보내면, 시트에 없는 티커를 A열 끝에 알아서 넣어요.
 * (수량·평단가·금액은 보내지 않아요) 그래서 티커를 직접 적지 않아도 돼요.
 * 시트에는 티커와 시세만 두세요. 수량·평단가·금액 같은 개인 정보는 절대 적지 마세요.
 * 기기 연동을 켜면 앱이 '연동 비밀번호'로 암호화한 자산 데이터를 숨긴 탭('앱 데이터')에 저장합니다 (아래 '기기 연동').
 * 아파트 실거래가(선택): 공공데이터포털 인증키를 스크립트 속성에 넣으면 집값을 최근 실거래가 평균으로 받아요 (맨 아래).
 * 이 코드는 어떤 정보도 다른 곳으로 보내지 않습니다.
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
 *  - A열: 티커. 앱이 보유 종목의 티커를 알아서 넣어요(아래 '티커 자동 추가'). 직접 적어도 돼요.
 *    직접 적을 때는 앱에 입력한 티커와 똑같이, 띄어쓰기 없이. 예) KRX:005930, KOSDAQ:247540, NASDAQ:QQQ, NYSEARCA:SCHD
 *    'NYSE: FCX'처럼 띄어쓰기가 들어가거나 소문자로 적으면 'NYSE:FCX'로 고쳐 적어요(onEdit).
 *  - B열·C열: 위 수식. A열에 티커를 적으면 자동으로 채워져요(onEdit). 안 채워지면 위 칸을 복사해 붙여넣으세요.
 *  - "CURRENCY:"로 시작하는 줄은 환율로 처리해요. CURRENCY:USDKRW → fx.USDKRW
 *    환율은 칸을 가리키거나 "price"를 붙이면 #N/A가 나는 경우가 있어 =GOOGLEFINANCE("CURRENCY:USDKRW")처럼 직접 적어요.
 *    통화(C열)는 환율 줄에서는 쓰지 않으니 비워 둬요.
 *  - B열 수식을 직접 고쳐 두었다면 그 수식은 건드리지 않아요. (이 코드가 넣은 수식만 바꿔요)
 *
 * ── 티커 자동 추가 ───────────────────────────────────────────
 *  앱이 시세를 요청할 때 ?tickers=KRX:005930,NASDAQ:QQQ 처럼 보유 종목 티커를 붙여 보내면,
 *  시트에 없는 티커만 A열 끝에 넣고 B·C열 수식을 채운 뒤 시세를 돌려줘요. (응답의 added: 새로 넣은 티커)
 *  거래소:종목코드 모양이 아닌 글자는 넣지 않고, 한 번에 150개·시트 1000줄까지만 넣어요. 지우는 일은 하지 않아요.
 *
 * ── 처음 한 번: setupSheet 실행 ──────────────────────────────────────
 *  편집기 위쪽 함수 목록에서 setupSheet를 고르고 [실행]을 누르면
 *  '시세' 탭, 제목 줄, 환율 줄이 만들어져요. 종목 줄은 앱이 알아서 넣어요. (이미 있는 내용은 지우지 않아요)
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
 *    "errors": ["KRX:123456"],     ← 가격을 받지 못한 티커 (#N/A 등)
 *    "added": ["NYSE:KO"],         ← 이번 요청에서 시트에 새로 넣은 티커 (가격은 잠시 뒤에 들어올 수 있어요)
 *    "features": ["add-tickers"]   ← 이 코드가 할 수 있는 일 (앱이 코드 버전을 알아보는 데 써요)
 *  }
 */

const SHEET_NAME = '시세';
const HEADER_ROWS = 1;
const CURRENCY_PREFIX = 'CURRENCY:';
const HEADER = ['티커', '가격', '통화'];
const FEATURES = ['add-tickers', 'apt-trades'];
// 티커 자동 추가: 거래소:종목코드 모양만 (예: KRX:005930, KRX:0085P0, NYSE:BRK.B, CURRENCY:USDKRW)
const ADD_TICKER_PATTERN = /^[A-Z][A-Z0-9]{0,14}:[A-Z0-9][A-Z0-9.\-]{0,19}$/;
const MAX_ADD_TICKERS = 150;
const MAX_QUOTE_ROWS = 1000;
// 새로 넣은 종목은 구글 금융이 가격을 채울 시간을 조금 준 뒤 읽는다 (못 채운 가격은 앱이 잠시 뒤 다시 받는다)
const ADD_WAIT_MS = 2500;

function jsonOutput_(result) {
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

// 앱이 시세를 요청할 때 실행된다 (웹 앱 GET 요청). ?action=sync-info 는 기기 연동 상태(아래 '기기 연동')
// ?tickers=… 가 있으면 시트에 없는 티커를 먼저 넣는다 (위 '티커 자동 추가')
function doGet(e) {
  let result;
  try {
    const params = (e && e.parameter) || {};
    if (params.action === 'sync-info') {
      result = syncInfo_();
    } else if (params.action === 'apt-complexes') {
      result = aptComplexes_(params);
    } else if (params.action === 'apt-price') {
      result = aptPrice_(params);
    } else {
      const added = params.tickers ? addTickers_(params.tickers) : [];
      if (added.length > 0) {
        SpreadsheetApp.flush();
        Utilities.sleep(ADD_WAIT_MS);
      }
      result = readQuotes_();
      result.added = added;
    }
  } catch (error) {
    // 실거래가 조회 오류는 앱이 알아보는 코드(aptError)로 돌려준다
    result = error && error.aptError
      ? { aptError: error.aptError, message: safeMessage_(error.message) }
      : { error: safeMessage_((error && error.message) || error) };
  }
  return jsonOutput_(result);
}

// 구글 오류 문구에 요청 주소(공공데이터 인증키가 들어 있음)가 섞여 나올 수 있어서, 주소의 ? 뒤와 serviceKey 값은 지운다
function safeMessage_(message) {
  return String(message || '')
    .replace(/(https?:\/\/[^\s?#]+)[?#]\S*/gi, '$1?…')
    .replace(/(service_?key\s*[=:]\s*)[^\s&,)]+/gi, '$1…');
}

// 기기 연동: 앱이 자산 데이터를 저장·불러올 때 실행된다 (웹 앱 POST 요청, 내용은 JSON)
function doPost(e) {
  let result;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    result = handleSync_(body);
  } catch (error) {
    result = { error: 'server', message: String((error && error.message) || error) };
  }
  return jsonOutput_(result);
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

// 처음 한 번 실행: '시세' 탭과 제목 줄, 환율 줄을 만든다. (종목 줄은 앱이 시세를 받을 때 알아서 넣는다)
function setupSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME, 0);
  sheet.getRange(1, 1, 1, 3).setValues([HEADER]).setFontWeight('bold');
  sheet.setFrozenRows(HEADER_ROWS);
  if (sheet.getLastRow() <= HEADER_ROWS) {
    sheet.getRange(HEADER_ROWS + 1, 1, 1, 1).setValues([['CURRENCY:USDKRW']]);
  }
  for (let row = HEADER_ROWS + 1; row <= sheet.getLastRow(); row += 1) fillFormulas_(sheet, row);
  sheet.autoResizeColumns(1, 3);
}

// 시세 탭: '시세', 없으면 첫 번째 탭 (기기 연동의 숨긴 탭 '앱 데이터'는 빼고)
function getQuoteSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const named = spreadsheet.getSheetByName(SHEET_NAME);
  if (named) return named;
  const others = spreadsheet.getSheets().filter((sheet) => sheet.getName() !== SYNC_SHEET_NAME);
  return others[0] || spreadsheet.insertSheet(SHEET_NAME, 0);
}

// 시세 탭 A열에 이미 있는 티커 (정리한 모양)
function sheetTickers_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= HEADER_ROWS) return [];
  return sheet.getRange(HEADER_ROWS + 1, 1, lastRow - HEADER_ROWS, 1).getValues().map((row) => normalizeTicker_(row[0]));
}

// 티커 자동 추가: 앱이 보낸 티커(쉼표로 구분) 중 시트에 없는 것만 A열 끝에 넣고 B·C열 수식을 채운다.
// 넣은 티커 목록을 돌려준다. 두 기기가 동시에 넣어도 겹치지 않게 잠근 뒤 한 번 더 확인한다.
function addTickers_(raw) {
  const wanted = [];
  String(raw).split(',').forEach((value) => {
    const ticker = normalizeTicker_(value);
    if (wanted.length < MAX_ADD_TICKERS && ADD_TICKER_PATTERN.test(ticker) && wanted.indexOf(ticker) === -1) wanted.push(ticker);
  });
  if (wanted.length === 0) return [];
  const sheet = getQuoteSheet_();
  const missingFrom = (existing) => wanted.filter((ticker) => existing.indexOf(ticker) === -1);
  if (missingFrom(sheetTickers_(sheet)).length === 0) return [];

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (sheet.getLastRow() < HEADER_ROWS) {
      sheet.getRange(1, 1, 1, 3).setValues([HEADER]).setFontWeight('bold');
      sheet.setFrozenRows(HEADER_ROWS);
    }
    const start = Math.max(sheet.getLastRow(), HEADER_ROWS) + 1;
    const missing = missingFrom(sheetTickers_(sheet)).slice(0, Math.max(0, MAX_QUOTE_ROWS - start + 1));
    if (missing.length === 0) return [];
    sheet.getRange(start, 1, missing.length, 1).setValues(missing.map((ticker) => [ticker]));
    sheet.getRange(start, 2, missing.length, 2).setFormulas(missing.map((ticker, index) => {
      const row = start + index;
      return [priceFormula_(ticker, row), ticker.indexOf(CURRENCY_PREFIX) === 0 ? '' : `=GOOGLEFINANCE(A${row}, "currency")`];
    }));
    return missing;
  } finally {
    lock.releaseLock();
  }
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
  const result = { updatedAt: new Date().toISOString(), fx: {}, prices: {}, errors: [], features: FEATURES, aptKey: Boolean(molitKey_()) };
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

// ── 기기 연동 (노트북·회사 PC 등에서 같은 데이터 쓰기) ─────────────────────
// 앱의 자산 데이터를 이 스프레드시트의 숨긴 탭 '앱 데이터'에 저장한다.
//  - 데이터는 앱에서 '연동 비밀번호'로 암호화한 뒤 보낸다. 이 코드와 시트에는 알아볼 수 없는 글자만 저장된다.
//  - 웹 앱 주소만 알아서는 읽거나 고칠 수 없다: 비밀번호로 만든 확인값(auth)이 맞아야 불러오기·저장이 된다.
//  - 다른 기기가 먼저 저장했으면(번호가 다르면) 덮어쓰지 않고 알려 준다 (conflict).
//  - 최신 1개 + 예전 기록 10개를 남겨서 앱에서 되돌릴 수 있다.
//  비밀번호를 잊었으면 '앱 데이터' 탭을 지우고 앱에서 연동을 다시 켜면 된다 (각 기기의 데이터는 그대로 남아 있다).

const SYNC_SHEET_NAME = '앱 데이터';
const SYNC_KEEP = 11;
const SYNC_CHUNK = 40000; // 한 칸에 넣는 글자 수 (구글 시트 칸 한도 5만 자보다 작게, 4의 배수)
const SYNC_META = { salt: 2, hint: 3, verifier: 4, revision: 5 };
const SYNC_HEADER_ROW = 7;
const SYNC_FIRST_ROW = 8;
const SYNC_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

// 시트 칸에 글자를 넣을 때 앞에 'v'를 붙인다. 날짜·숫자·수식으로 바뀌지 않고 글자 그대로 저장되게.
function cell_(text) {
  return `v${text}`;
}

function uncell_(value) {
  return typeof value === 'string' && value.charAt(0) === 'v' ? value.slice(1) : '';
}

function syncSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SYNC_SHEET_NAME);
}

function readSyncMeta_(sheet) {
  if (!sheet || sheet.getLastRow() < SYNC_META.revision) return null;
  const values = sheet.getRange(SYNC_META.salt, 2, 4, 1).getValues().map((row) => row[0]);
  const meta = { salt: uncell_(values[0]), hint: uncell_(values[1]), verifier: uncell_(values[2]), revision: Number(values[3]) || 0 };
  return meta.salt && meta.verifier ? meta : null;
}

function readSyncRecords_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < SYNC_FIRST_ROW) return [];
  const width = Math.max(sheet.getLastColumn(), 7);
  return sheet.getRange(SYNC_FIRST_ROW, 1, lastRow - SYNC_FIRST_ROW + 1, width).getValues()
    .filter((row) => Number(row[0]) > 0)
    .map((row) => {
      const count = Number(row[5]) || 0;
      return {
        revision: Number(row[0]),
        savedAt: uncell_(row[1]),
        device: uncell_(row[2]),
        iv: uncell_(row[3]),
        zip: uncell_(row[4]),
        data: row.slice(6, 6 + count).map(uncell_).join(''),
      };
    });
}

function writeSyncRecord_(sheet, record) {
  const chunks = [];
  for (let i = 0; i < record.data.length; i += SYNC_CHUNK) chunks.push(record.data.slice(i, i + SYNC_CHUNK));
  const values = [record.revision, cell_(record.savedAt), cell_(record.device), cell_(record.iv), cell_(record.zip), chunks.length, ...chunks.map(cell_)];
  sheet.insertRowBefore(SYNC_FIRST_ROW);
  sheet.getRange(SYNC_FIRST_ROW, 1, 1, values.length).setValues([values]);
  const lastRow = sheet.getLastRow();
  const keepUntil = SYNC_FIRST_ROW + SYNC_KEEP - 1;
  if (lastRow > keepUntil) sheet.deleteRows(keepUntil + 1, lastRow - keepUntil);
}

// 확인값: 앱이 비밀번호로 만든 auth의 SHA-256 (auth 자체는 저장하지 않는다)
function syncDigest_(text) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8));
}

function cleanText_(value, maxLength) {
  return String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLength);
}

// 앱이 보낸 암호화된 데이터 검사
function cleanPayload_(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const iv = String(payload.iv || '');
  const data = String(payload.data || '');
  if (!SYNC_BASE64.test(iv) || !SYNC_BASE64.test(data) || data.length > 5000000) return null;
  return { iv, data, zip: payload.zip === 'gzip' ? 'gzip' : 'none' };
}

function latestInfo_(sheet, meta) {
  const latest = readSyncRecords_(sheet)[0];
  return { revision: meta.revision, savedAt: latest ? latest.savedAt : '', device: latest ? latest.device : '' };
}

// 연동 상태: 비밀번호 없이 볼 수 있는 것은 솔트(암호 계산용 값)·힌트·저장 번호뿐이다.
function syncInfo_() {
  const sheet = syncSheet_();
  const meta = readSyncMeta_(sheet);
  if (!meta) return { sync: 1, exists: false };
  return { sync: 1, exists: true, salt: meta.salt, hint: meta.hint, ...latestInfo_(sheet, meta) };
}

function handleSync_(body) {
  const action = body && body.action;
  if (action === 'sync-setup' || action === 'sync-save') {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      return action === 'sync-setup' ? syncSetup_(body) : syncSave_(body);
    } finally {
      lock.releaseLock();
    }
  }
  if (action === 'sync-load') return syncLoad_(body);
  if (action === 'sync-history') return syncHistory_(body);
  return { error: 'action', message: '알 수 없는 요청이에요.' };
}

// 비밀번호 확인. 맞으면 { sheet, meta }, 아니면 { error }
function syncAuth_(body) {
  const sheet = syncSheet_();
  const meta = readSyncMeta_(sheet);
  if (!meta) return { error: 'not-setup', message: '아직 연동을 켜지 않았어요.' };
  if (!body.auth || syncDigest_(body.auth) !== meta.verifier) return { error: 'auth', message: '연동 비밀번호가 맞지 않아요.' };
  return { sheet, meta };
}

// 처음 켜는 기기: 솔트·힌트·확인값과 첫 데이터를 저장한다. 이미 켜져 있으면 덮어쓰지 않는다.
function syncSetup_(body) {
  let sheet = syncSheet_();
  if (readSyncMeta_(sheet)) return { error: 'exists', message: '이미 다른 기기에서 연동을 켰어요. 그 비밀번호로 연결해 주세요.' };
  const payload = cleanPayload_(body.payload);
  const salt = String(body.salt || '');
  if (!payload || !SYNC_BASE64.test(salt) || !body.auth) return { error: 'format', message: '보낸 내용이 올바르지 않아요.' };
  if (!sheet) sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(SYNC_SHEET_NAME);
  sheet.clear();
  sheet.getRange(1, 1).setValue('앱이 쓰는 기기 연동 탭이에요. 고치지 마세요. 연동 비밀번호를 잊었으면 이 탭을 지우고 앱에서 연동을 다시 켜세요.');
  sheet.getRange(SYNC_META.salt, 1, 4, 2).setValues([
    ['솔트', cell_(salt)],
    ['힌트', cell_(cleanText_(body.hint, 100))],
    ['확인값', cell_(syncDigest_(body.auth))],
    ['최신 번호', 1],
  ]);
  sheet.getRange(SYNC_HEADER_ROW, 1, 1, 7).setValues([['번호', '저장 시각', '기기', 'IV', '압축', '조각 수', '데이터 (여러 칸에 나눠 저장)']]);
  const savedAt = new Date().toISOString();
  writeSyncRecord_(sheet, { revision: 1, savedAt, device: cleanText_(body.device, 30), ...payload });
  sheet.hideSheet();
  return { ok: true, revision: 1, savedAt };
}

// 저장: 이 기기가 마지막으로 받은 번호(baseRevision)가 지금 번호와 같을 때만 저장한다.
function syncSave_(body) {
  const auth = syncAuth_(body);
  if (auth.error) return auth;
  const { sheet, meta } = auth;
  if (Number(body.baseRevision) !== meta.revision) return { conflict: true, ...latestInfo_(sheet, meta) };
  const payload = cleanPayload_(body.payload);
  if (!payload) return { error: 'format', message: '보낸 내용이 올바르지 않아요.' };
  const revision = meta.revision + 1;
  const savedAt = new Date().toISOString();
  writeSyncRecord_(sheet, { revision, savedAt, device: cleanText_(body.device, 30), ...payload });
  sheet.getRange(SYNC_META.revision, 2).setValue(revision);
  return { ok: true, revision, savedAt };
}

// 불러오기: 최신(또는 revision 번호의 예전 기록) 암호화 데이터
function syncLoad_(body) {
  const auth = syncAuth_(body);
  if (auth.error) return auth;
  const records = readSyncRecords_(auth.sheet);
  const wanted = body.revision == null ? records[0] : records.find((record) => record.revision === Number(body.revision));
  if (!wanted) return { error: 'not-found', message: '그 저장 기록이 없어요.' };
  return { ok: true, ...wanted };
}

// 저장 기록 목록 (최신부터)
function syncHistory_(body) {
  const auth = syncAuth_(body);
  if (auth.error) return auth;
  return {
    ok: true,
    records: readSyncRecords_(auth.sheet).map((record) => ({ revision: record.revision, savedAt: record.savedAt, device: record.device })),
  };
}

// ── 아파트 실거래가 (선택) ─────────────────────────────────────────
// 국토교통부 아파트 매매 실거래가 공공데이터로 집값을 '최근 3개월(없으면 6·12개월) 거래 평균'으로 계산한다.
//  인증키: 공공데이터포털(data.go.kr)에서 '국토교통부_아파트 매매 실거래가 상세 자료'를 활용신청해 받은 일반 인증키(Decoding)
//  넣는 곳: 이 편집기 왼쪽 톱니바퀴 [프로젝트 설정] → 맨 아래 [스크립트 속성] → 속성 MOLIT_API_KEY, 값 = 인증키
//          (코드나 시트에는 적지 마세요. 스크립트 속성은 이 프로젝트 안에만 저장되고 앱으로 보내지 않아요)
//  처음 한 번: 함수 목록에서 checkRealEstateKey를 골라 [실행]하면 외부 연결 권한을 허용하고 인증키를 확인해요.
//  ?action=apt-complexes&lawd=11680  → 그 시·군·구에서 최근 12개월 동안 거래된 단지 목록 (단지·전용면적 고르기용)
//  ?action=apt-price&lawd=11680&apt=단지일련번호&name=단지명&dong=법정동&area=84.97
//                                     → 그 단지·전용면적(±1㎡)의 최근 3·6·12개월 거래 평균 (해제된 거래는 뺌)
//  같은 달 자료는 6시간 동안 다시 받지 않는다 (공공데이터 하루 사용량 아끼기).

const MOLIT_KEY_PROPERTY = 'MOLIT_API_KEY';
const MOLIT_ENDPOINT_PROPERTY = 'MOLIT_ENDPOINT';
const MOLIT_ENDPOINTS = [
  'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev', // 상세 자료 (단지 일련번호 있음)
  'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade', // 기본 자료
];
const APT_MONTHS = 12;
const APT_WINDOWS = [3, 6, 12];
const APT_AREA_TOLERANCE = 1; // 전용면적 차이(㎡)가 이 안이면 같은 평형으로 본다
const APT_PAGE_SIZE = 1000;
const APT_MAX_PAGES = 5;
const APT_CACHE_SECONDS = 6 * 60 * 60;
const APT_CACHE_LIMIT = 90000; // 캐시 한 칸 크기 한도(100KB)보다 작게

function molitError_(code, message) {
  const error = new Error(message || code);
  error.aptError = code;
  return error;
}

function molitKey_() {
  const raw = String(PropertiesService.getScriptProperties().getProperty(MOLIT_KEY_PROPERTY) || '').trim();
  if (!raw) return '';
  // Encoding 키(%가 들어 있음)를 넣었어도 쓸 수 있게 한 번 풀어 둔다
  try {
    return raw.indexOf('%') >= 0 ? decodeURIComponent(raw) : raw;
  } catch (e) {
    return raw;
  }
}

function decodeXml_(text) {
  return String(text)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (match, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

// 공공데이터 오류 → 앱이 알아보는 코드
//  key: 인증키가 없거나 틀림·아직 승인 처리 중 / expired: 활용 기간 끝남 / limit: 하루 사용량 초과 / api: 그 밖
function molitErrorCode_(reason, message) {
  const text = `${reason || ''} ${message || ''}`;
  if (/31|DEADLINE|EXPIRED/i.test(text)) return 'expired';
  if (/22|LIMIT/i.test(text)) return 'limit';
  if (/30|20|32|KEY|REGISTERED|ACCESS|DENIED|Unauthorized|Forbidden|IP/i.test(text)) return 'key';
  return 'api';
}

// 응답 XML → { items: [{ 항목: 값 }], total } 또는 { error, message }
function parseMolitXml_(text) {
  const source = String(text || '');
  const tag = (name) => {
    const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(source);
    return match ? decodeXml_(match[1]).trim() : '';
  };
  if (/OpenAPI_ServiceResponse/.test(source) || tag('returnAuthMsg') || tag('errMsg')) {
    const message = tag('returnAuthMsg') || tag('errMsg');
    return { error: molitErrorCode_(tag('returnReasonCode'), message), message };
  }
  const code = tag('resultCode');
  if (!/<response>/.test(source) && !/<items/.test(source)) {
    return { error: molitErrorCode_('', source.slice(0, 200)), message: source.slice(0, 200) };
  }
  if (code && code !== '000' && code !== '00') return { error: molitErrorCode_(code, tag('resultMsg')), message: tag('resultMsg') || code };
  const items = [];
  const itemPattern = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemPattern.exec(source))) {
    const fields = {};
    const fieldPattern = /<(\w+)>([^<]*)<\/\1>/g;
    let field;
    while ((field = fieldPattern.exec(match[1]))) fields[field[1]] = decodeXml_(field[2]).trim();
    items.push(fields);
  }
  return { items, total: Number(tag('totalCount')) || items.length };
}

// 거래 하나 → 짧은 배열 [단지번호, 단지명, 법정동, 전용면적, 거래금액(원), 연, 월, 일, 층, 해제여부(1/0), 지번]
function compactTrade_(item) {
  const amount = Number(String(item.dealAmount || '').replace(/[,\s]/g, '')) * 10000;
  return [
    item.aptSeq || '', item.aptNm || '', item.umdNm || '', Number(item.excluUseAr) || 0, amount,
    Number(item.dealYear) || 0, Number(item.dealMonth) || 0, Number(item.dealDay) || 0, Number(item.floor) || 0,
    item.cdealType && item.cdealType.trim() ? 1 : 0, item.jibun || '',
  ];
}

// 이번 달부터 거꾸로 count달: ['202611', '202610', …]
function aptMonths_(count, now) {
  const today = now || new Date();
  const months = [];
  for (let i = 0; i < count; i += 1) {
    const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
    months.push(`${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

function cleanLawd_(value) {
  const lawd = String(value || '').trim();
  if (!/^\d{5}$/.test(lawd)) throw molitError_('bad-request', '시·군·구 코드(5자리 숫자)가 필요해요.');
  return lawd;
}

// 여러 달을 한꺼번에 받는다 (UrlFetchApp.fetchAll). 돌려주는 값: { 'YYYYMM': [짧은 거래 배열] }
// 상세 자료를 쓸 수 없는 인증키면(기본 자료만 신청) 기본 자료로 다시 받는다.
function molitTrades_(lawd, months) {
  const key = molitKey_();
  if (!key) throw molitError_('no-key', '스크립트 속성에 MOLIT_API_KEY가 없어요.');
  const cache = CacheService.getScriptCache();
  const result = {};
  const missing = [];
  months.forEach((ym) => {
    const hit = cache.get(`apt:${lawd}:${ym}`);
    if (hit) result[ym] = JSON.parse(hit);
    else missing.push(ym);
  });
  if (missing.length === 0) return result;

  const properties = PropertiesService.getScriptProperties();
  const preferred = Number(properties.getProperty(MOLIT_ENDPOINT_PROPERTY)) || 0;
  const order = [preferred, 1 - preferred].filter((index) => MOLIT_ENDPOINTS[index]);
  let lastError = null;
  for (const index of order) {
    const endpoint = MOLIT_ENDPOINTS[index];
    const url = (ym, page) => `${endpoint}?serviceKey=${encodeURIComponent(key)}&LAWD_CD=${lawd}&DEAL_YMD=${ym}&pageNo=${page}&numOfRows=${APT_PAGE_SIZE}`;
    const read = (response) => {
      const status = response.getResponseCode();
      const parsed = parseMolitXml_(response.getContentText());
      if (status >= 400 && !parsed.error) return { error: status === 429 ? 'limit' : status === 401 || status === 403 ? 'key' : 'api', message: `HTTP ${status}` };
      return parsed;
    };
    const first = UrlFetchApp.fetchAll(missing.map((ym) => ({ url: url(ym, 1), muteHttpExceptions: true }))).map(read);
    const failed = first.find((page) => page.error);
    if (failed) {
      lastError = failed;
      if (failed.error === 'key') continue; // 이 자료는 신청하지 않은 키일 수 있으니 다른 자료로
      throw molitError_(failed.error, failed.message);
    }
    // 한 달에 1000건이 넘으면 나머지 쪽도 받는다
    const more = [];
    first.forEach((page, i) => {
      const pages = Math.min(APT_MAX_PAGES, Math.ceil(page.total / APT_PAGE_SIZE));
      for (let p = 2; p <= pages; p += 1) more.push({ ym: missing[i], page: p });
    });
    const extra = more.length ? UrlFetchApp.fetchAll(more.map((entry) => ({ url: url(entry.ym, entry.page), muteHttpExceptions: true }))).map(read) : [];
    missing.forEach((ym, i) => {
      const items = first[i].items.slice();
      extra.forEach((page, j) => { if (more[j].ym === ym && !page.error) items.push(...page.items); });
      const rows = items.map(compactTrade_);
      result[ym] = rows;
      const text = JSON.stringify(rows);
      if (text.length < APT_CACHE_LIMIT) cache.put(`apt:${lawd}:${ym}`, text, APT_CACHE_SECONDS);
    });
    if (index !== preferred) properties.setProperty(MOLIT_ENDPOINT_PROPERTY, String(index));
    return result;
  }
  throw molitError_(lastError ? lastError.error : 'api', lastError ? lastError.message : '');
}

// 그 시·군·구에서 최근 12개월 동안 거래된 단지 목록 (해제된 거래는 뺌)
//  { lawd, complexes: [{ apt, name, dong, jibun, count, areas: [{ area, count }] }] }
function aptComplexes_(params) {
  const lawd = cleanLawd_(params.lawd);
  const data = molitTrades_(lawd, aptMonths_(APT_MONTHS));
  const map = {};
  Object.keys(data).forEach((ym) => data[ym].forEach((row) => {
    if (row[9]) return;
    const id = row[0] || `${row[1]}|${row[2]}`;
    const entry = map[id] || (map[id] = { apt: row[0], name: row[1], dong: row[2], jibun: row[10], count: 0, areas: {} });
    entry.count += 1;
    const area = (Math.round(row[3] * 100) / 100).toFixed(2);
    entry.areas[area] = (entry.areas[area] || 0) + 1;
  }));
  const complexes = Object.keys(map).map((id) => {
    const entry = map[id];
    const areas = Object.keys(entry.areas).map((area) => ({ area: Number(area), count: entry.areas[area] })).sort((a, b) => a.area - b.area);
    return { apt: entry.apt, name: entry.name, dong: entry.dong, jibun: entry.jibun, count: entry.count, areas };
  }).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return { lawd, months: APT_MONTHS, complexes };
}

// 그 단지·전용면적의 최근 3·6·12개월 거래 평균. 가장 짧은 기간부터 거래가 있는 기간의 평균을 쓴다(used).
function aptPrice_(params) {
  const lawd = cleanLawd_(params.lawd);
  const apt = String(params.apt || '').trim();
  const name = String(params.name || '').trim();
  const dong = String(params.dong || '').trim();
  const area = Number(params.area);
  if (!(area > 0) || (!apt && !name)) throw molitError_('bad-request', '단지와 전용면적이 필요해요.');
  const months = aptMonths_(APT_MONTHS);
  const data = molitTrades_(lawd, months);
  const trades = [];
  months.forEach((ym, monthIndex) => (data[ym] || []).forEach((row) => {
    if (row[9]) return; // 해제(취소)된 거래
    const same = apt && row[0] ? row[0] === apt : row[1] === name && (!dong || row[2] === dong);
    if (!same || Math.abs(row[3] - area) > APT_AREA_TOLERANCE) return;
    trades.push({
      date: `${row[5]}-${String(row[6]).padStart(2, '0')}-${String(row[7]).padStart(2, '0')}`,
      amount: row[4], floor: row[8], area: row[3], monthIndex,
    });
  }));
  trades.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const windows = APT_WINDOWS.map((count) => {
    const list = trades.filter((trade) => trade.monthIndex < count);
    const amounts = list.map((trade) => trade.amount);
    return {
      months: count,
      count: list.length,
      average: list.length ? Math.round(amounts.reduce((sum, value) => sum + value, 0) / list.length) : null,
      min: list.length ? Math.min(...amounts) : null,
      max: list.length ? Math.max(...amounts) : null,
      from: months[count - 1],
      to: months[0],
    };
  });
  return {
    lawd, apt, name, dong, area,
    windows,
    used: windows.find((window) => window.count > 0) || null,
    trades: trades.slice(0, 20).map((trade) => ({ date: trade.date, amount: trade.amount, floor: trade.floor, area: trade.area })),
    updatedAt: new Date().toISOString(),
  };
}

// 편집기에서 한 번 실행: 외부 연결 권한을 허용하고, 인증키로 서울 종로구 이번 달 자료를 받아 본다.
function checkRealEstateKey() {
  try {
    const data = molitTrades_('11110', aptMonths_(1));
    const count = Object.keys(data).reduce((sum, ym) => sum + data[ym].length, 0);
    Logger.log(`인증키가 잘 동작해요. (서울 종로구 이번 달 거래 ${count}건을 받았어요)`);
  } catch (error) {
    const messages = {
      'no-key': '스크립트 속성에 MOLIT_API_KEY가 없어요. [프로젝트 설정] → [스크립트 속성]에 인증키를 넣어 주세요.',
      key: '인증키가 맞지 않거나 아직 승인 처리 중이에요. 승인 뒤 1~2시간 지나 다시 해 보세요. (Decoding 키를 넣었는지도 확인해 주세요)',
      expired: '인증키 활용 기간이 끝났어요. 공공데이터포털 마이페이지에서 연장 신청해 주세요.',
      limit: '오늘 쓸 수 있는 횟수를 다 썼어요. 내일 다시 해 보세요.',
    };
    Logger.log(`${messages[error.aptError] || '실거래가를 받지 못했어요.'} (${error.message})`);
  }
}
