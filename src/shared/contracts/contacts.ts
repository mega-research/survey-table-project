// 컨택 JSONB 계약 — surveys.contact_columns·contact_result_codes, contact_uploads.mapping, contact_targets.contact_method.
// DB 스키마($type<>)·서버·UI 가 공유하는 어휘 — 런타임 의존 없음(리터럴 상수 제외).

// ─────────────────────────────────────────────────────────────────────────────
// 컨택 (contact_targets·contact_uploads) 관련 JSONB 타입
// ─────────────────────────────────────────────────────────────────────────────

/** surveys.contact_columns — 컨택리스트 표시 컬럼 스킴 (메타데이터) */
export interface ContactColumnScheme {
  version: number;
  /** 엑셀 헤더 행 (1-based, 디폴트 1) */
  headerRow: number;
  columns: ContactColumnDef[];
}

export interface ContactColumnDef {
  /** attrs 의 키 또는 system 식별자 */
  key: string;
  /** 표 헤더 라벨 (사용자 편집 가능) */
  label: string;
  source:
    | `attrs.${string}`
    | 'system.resid'
    | 'system.contact_result'
    | 'system.email_count'
    | 'system.web'
    | 'system.contact_owner'
    | `pii.${string}`;
  order: number;
  /** 숨김 (운영 컬럼 일부는 hide 불가 — UI 가드) */
  hidden?: boolean;
  /**
   * PII 매핑 타입. 지정되면 해당 엑셀 컬럼 값이 contact_pii 사이드 테이블에
   * 암호화 저장되고, attrs 에는 저장되지 않는다. 사후 변경 불가 — 재업로드 필요.
   */
  piiType?: import('@/lib/crypto/pii-fields').PiiFieldType;
  /**
   * @deprecated groupLevel 로 대체 (2026-08-17). 과거 저장분 읽기 호환용으로만 유지 —
   * resolveGroupCriteria 가 컬럼 순서대로 레벨 1..4 로 해석한다. 신규 저장 금지.
   */
  groupBy?: boolean;
  /**
   * 진척보고 분류 기준 레벨 슬롯. 1=대분류, 2=중분류, 3=소분류, 4=세부분류.
   * attrs.* 소스 전용, 레벨당 컬럼 1개 (UI + 서비스 이중 가드).
   * 임의 컬럼을 슬롯에 배정하는 모델 — 예: '산업 분류' 컬럼에 1(대분류),
   * '종사자 구간' 컬럼에 2(중분류). 진척보고는 레벨 순서대로 조합 집계한다.
   */
  groupLevel?: 1 | 2 | 3 | 4;
}

/** 컨택 업로드 모드. replace=전체 교체(기존 동작), merge=키 일치 갱신, append=신규 추가 */
export type ContactUploadMode = 'replace' | 'merge' | 'append';

/** contact_uploads.mapping — 엑셀 업로드 매핑 결과 (시나리오 B 단순화) */
export interface ContactUploadMapping {
  /** 시스템 필드 → 엑셀 0-based 컬럼 인덱스. group 만 사용 (미지정 시 단일 명단 취급). */
  systemFields: {
    group?: number;
  };
  /**
   * 엑셀 헤더 → PII 타입 매핑. 키는 엑셀 헤더(원본 컬럼명), 값은 PII 타입.
   * 매핑된 컬럼은 contact_pii 사이드 테이블에 암호화 저장, attrs 에는 저장 안 함.
   */
  piiMapping?: Record<string, import('@/lib/crypto/pii-fields').PiiFieldType>;
  /** 사용자가 컨택리스트에 표시하기로 토글한 attrs 키 (헤더명) 목록. 나머지는 hidden 으로 자동 등록. */
  selectedAttrsKeys: string[];
  /**
   * 분류 기준 레벨 배정 (헤더명 → 1..4). replace 업로드 시 생성되는 컬럼 스킴의
   * groupLevel 로 반영된다. 레벨 1(대분류) 헤더는 group_value 소스(systemFields.group)와
   * 일치해야 한다 — 마법사가 동기화.
   */
  groupLevels?: Record<string, number>;
  /** 사용자가 편집한 표시 라벨 (헤더명 → 라벨). 미지정 헤더는 헤더명 그대로. */
  labelOverrides?: Record<string, string>;
  /** 1-based, 디폴트 1 */
  headerRow: number;
  /** 사용자가 선택한 시트 이름 (디폴트 첫 시트) */
  sheetName: string;
  /** 업로드 모드. 미지정(과거 데이터)은 replace 로 간주. */
  mode?: ContactUploadMode;
  /**
   * 매칭 키 — 정규화된 엑셀 헤더명 목록 (복합키 가능).
   * merge 모드 필수, append 모드는 중복 검사 시에만. PII 매핑 컬럼은 키 불가.
   */
  mergeKeys?: string[];
  /** merge: 키 불일치 행 처리 — insert(신규 추가) | skip(제외) */
  unmatchedPolicy?: 'insert' | 'skip';
  /** append+중복검사: 키 일치(중복) 행 처리 — insert(그래도 추가) | skip(제외) */
  duplicatePolicy?: 'insert' | 'skip';
}

// ─────────────────────────────────────────────────────────────────────────────
// 컨택 단건 편집 (slice 3 detail page) 타입
// ─────────────────────────────────────────────────────────────────────────────

export type ContactMethod = 'email' | 'sms' | 'visit' | 'mail';

export const CONTACT_METHOD_LABEL: Record<ContactMethod, string> = {
  email: '이메일',
  sms: '문자',
  visit: '방문',
  mail: '우편',
};

/** 결과코드 상태 — 응답률·모집단 처리 분류. */
export type ResultCodeStatus = 'positive' | 'negative' | 'neutral';

/** 결과코드 1개 정의 — surveys.contact_result_codes JSONB 안의 항목 */
export interface ContactResultCode {
  /** UI 표시 코드 (예: '1.조사완료'). 사용자 자유 텍스트. */
  code: string;
  /** UI 라벨 (코드와 동일하게 두는 게 일반적) */
  label: string;
  /** 정렬 순서 */
  order: number;
  /**
   * pill 색상 톤. mockup 의 컨택결과 이력 표 색상 매칭용.
   */
  tone?: 'green' | 'amber' | 'rose' | 'blue' | 'slate';
  /**
   * 응답률·모집단 처리.
   * - 'positive': 응답 완료로 인정 (응답률 분자)
   * - 'neutral': 응답률 분모에만 포함
   * - 'negative': 모집단 완전 제외 — 응답률·단체메일·응답 페이지 모두 제거
   *
   * 누락 (undefined) 시 fallback:
   * - code === '1.조사완료' → 'positive' (backward compat)
   * - 그 외 → 'neutral'
   * 사용자가 빌더에서 한 번 저장하면 명시 status 박힘 → fallback 우회.
   */
  status?: ResultCodeStatus;
}

/**
 * surveys.contact_result_codes 가 NULL 일 때 사용되는 디폴트 13개.
 * mockup §6 의 결과코드 라디오 그대로.
 *
 * status 매핑:
 * - '1.조사완료' → 'positive' (응답 완료 인정)
 * - '수신거부' → 'negative' (모집단 제외)
 * - 나머지 11개 → 필드 생략 (= 'neutral')
 */
export const DEFAULT_RESULT_CODES: ContactResultCode[] = [
  { code: '1.조사완료', label: '1.조사완료', order: 1, tone: 'green', status: 'positive' },
  { code: '2.재통화예약', label: '2.재통화예약', order: 2, tone: 'blue' },
  { code: '3.비수신', label: '3.비수신', order: 3, tone: 'slate' },
  { code: '4.부재', label: '4.부재', order: 4, tone: 'slate' },
  { code: '5.출장', label: '5.출장', order: 5, tone: 'slate' },
  { code: '6.거절', label: '6.거절', order: 6, tone: 'rose' },
  { code: '7.결번·번호오류', label: '7.결번·번호오류', order: 7, tone: 'rose' },
  { code: '8.중복', label: '8.중복', order: 8, tone: 'slate' },
  { code: '9.전시회미참가', label: '9.전시회미참가', order: 9, tone: 'slate' },
  { code: '10.메일발송', label: '10.메일발송', order: 10, tone: 'blue' },
  { code: '11.기타', label: '11.기타', order: 11, tone: 'amber' },
  { code: '12.담당자퇴사', label: '12.담당자퇴사', order: 12, tone: 'rose' },
  { code: '수신거부', label: '수신거부', order: 13, tone: 'rose', status: 'negative' },
];
