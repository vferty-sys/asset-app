/**
 * 내 자산 한눈에 — 구글 시트 시세 연동 코드 (Apps Script)
 *
 * 이 코드는 시트에 적힌 티커의 현재가·통화와 달러 환율을 앱이 읽을 수 있는 JSON으로 돌려줍니다.
 * 시트에는 티커와 시세만 두세요. 수량·평단가·금액 같은 개인 정보는 절대 적지 마세요.
 * 기기 연동을 켜면 앱이 '연동 비밀번호'로 암호화한 자산 데이터를 숨긴 탭('앱 데이터')에 저장합니다 (맨 아래 '기기 연동').
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

function jsonOutput_(result) {
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

// 앱이 시세를 요청할 때 실행된다 (웹 앱 GET 요청). ?action=sync-info 는 기기 연동 상태(아래 '기기 연동')
function doGet(e) {
  let result;
  try {
    const action = e && e.parameter ? e.parameter.action : '';
    result = action === 'sync-info' ? syncInfo_() : readQuotes_();
  } catch (error) {
    result = { error: String((error && error.message) || error) };
  }
  return jsonOutput_(result);
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
