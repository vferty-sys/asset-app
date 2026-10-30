// 앱 전체에서 쓰는 상수와 기본값.
// 숫자 기준값은 여기만 고치면 앱 전체에 반영된다.

export const APP_NAME = '내 자산 한눈에';

// 같은 github.io 주소의 다른 앱과 겹치지 않도록 모든 키에 접두어를 붙인다.
export const STORAGE_PREFIX = 'assetApp.';
export const STORAGE_KEYS = Object.freeze({
  data: `${STORAGE_PREFIX}data`,
  priceCache: `${STORAGE_PREFIX}priceCache`,
});

export const ACCOUNTS = Object.freeze(['일반', 'ISA', '연금저축', 'IRP', '기타']);
export const ASSET_CLASSES = Object.freeze(['성장주', '배당주', '채권', '현금성', '기타']);
export const CURRENCIES = Object.freeze(['KRW', 'USD']);
export const HOLDING_TYPES = Object.freeze(['stock', 'etf']);
export const HOLDING_TYPE_LABELS = Object.freeze({ stock: '개별 주식', etf: 'ETF' });

// 국가·섹터 선택지. CSV나 백업으로 들어온 다른 이름도 그대로 쓸 수 있다.
export const COUNTRY_OPTIONS = Object.freeze(['한국', '미국', '중국', '일본', '유럽', '신흥국', '기타']);
export const SECTOR_OPTIONS = Object.freeze([
  '기술', '통신', '소비재', '필수소비재', '헬스케어', '금융', '산업재',
  '에너지', '소재', '유틸리티', '부동산', '채권', '현금성', '기타',
]);
export const OTHER_ASSET_TYPES = Object.freeze(['공제회', '예금', '적금', '기타']);
export const COMPOUNDING_TYPES = Object.freeze(['월복리', '연복리', '단리']);
export const PENSION_CATEGORIES = Object.freeze([
  '공무원연금', '국민연금', '퇴직연금', '연금저축', 'IRP', '연금보험', '기타',
]);

// 설정 항목의 형식·범위·기본값. 저장 데이터 정리와 설정 화면 입력 검증에 함께 쓴다.
// 비율(%) 값은 사람이 입력하는 그대로 퍼센트 숫자로 저장한다. (예: 2.5 → 2.5%)
export const SETTINGS_SCHEMA = Object.freeze({
  // 시세 연결
  sheetUrl: { type: 'url', default: '' },
  manualFxUsdKrw: { type: 'number', nullable: true, min: 1, max: 100000, default: null },

  // 내 정보
  birthYear: { type: 'integer', nullable: true, min: 1900, max: 2100, default: null },
  birthMonth: { type: 'integer', min: 1, max: 12, default: 1 },
  retirementDate: { type: 'yearMonth', nullable: true, default: null },
  lifeExpectancy: { type: 'integer', min: 50, max: 120, default: 90 },
  monthlyLivingCost: { type: 'number', nullable: true, min: 0, default: null },
  pensionTaxRate: { type: 'number', min: 0, max: 50, default: 5.5 },

  // 미래 예측 가정
  inflationRate: { type: 'number', min: -5, max: 20, default: 2.5 },
  stockReturnLow: { type: 'number', min: -30, max: 30, default: 3 },
  stockReturnBase: { type: 'number', min: -30, max: 30, default: 5 },
  stockReturnHigh: { type: 'number', min: -30, max: 30, default: 7 },
  stockMonthlyInvestment: { type: 'number', min: 0, default: 0 },

  // 쏠림 경고 기준
  warnSector: { type: 'number', min: 1, max: 100, default: 40 },
  warnCountry: { type: 'number', min: 1, max: 100, default: 70 },
  warnSingle: { type: 'number', min: 1, max: 100, default: 25 },

  // 리밸런싱·매매
  rebalanceBand: { type: 'number', min: 0, max: 50, default: 5 },
  feeRateDomestic: { type: 'number', min: 0, max: 5, default: 0.015 },
  feeRateOverseas: { type: 'number', min: 0, max: 5, default: 0.015 },
  domesticSellTaxRate: { type: 'number', min: 0, max: 5, default: 0.2 },
  allowFractionalUS: { type: 'boolean', default: false },

  // 화면
  displayUnit: { type: 'enum', options: ['auto', 'won', 'man'], default: 'auto' },
  theme: { type: 'enum', options: ['system', 'light', 'dark'], default: 'system' },
  invertPnlColors: { type: 'boolean', default: false },
});

export const DEFAULT_SETTINGS = Object.freeze(
  Object.fromEntries(Object.entries(SETTINGS_SCHEMA).map(([key, spec]) => [key, spec.default])),
);

export const META_SCHEMA = Object.freeze({
  createdAt: { type: 'string', default: '' },
  onboardingDone: { type: 'boolean', default: false },
  snapshotPromptMonth: { type: 'yearMonth', nullable: true, default: null },
});

export const TARGET_MODES = Object.freeze(['assetClass', 'ticker']);
