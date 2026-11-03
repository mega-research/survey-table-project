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
   * 메일 발송 표(단체 메일 위저드 미리보기·캠페인 상세 수신자 표·수신거부 명단)에 이 컬럼을 표시.
   * attrs.*·pii.*(마스킹 힌트로)·system.resid 만 — 운영 컬럼은 서비스 가드가 거부한다.
   * attrs·pii 는 켜야(true) 보이고, 시스템ID 는 기본으로 보여 끈 경우에만 false 가 저장된다.
   * 조사 대상 목록의 hidden 과는 독립이다. 해석은 `lib/contacts/mail-display-columns`.
   */
  showInMail?: boolean;
  /**
   * 메일 발송 주소 순서 (1부터). 이메일로 암호화된 열(`piiType: 'email'`) 전용.
   * 순위를 준 열만 발송 주소 후보가 되고, 순위 오름차순으로 값이 있는 첫 열의 주소로 보낸다.
   * 어느 열에도 순위가 없으면 종전대로 열 이름(column_key) 오름차순 첫 열이다.
   * 해석은 `lib/contacts/mail-email-order` 의 `resolveMailEmailOrder` 한 곳.
   */
  mailOrder?: number;
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

/**
 * contact_assignments.last_clauses — 마지막으로 교체 적용한 조건 줄 한 개.
 * 조사 대상 필터 URL 의 col/q/op 와 같은 모양이다(source=col, value=q, op=op).
 * 첫 줄의 op 는 빈 문자열. 2,000개 넘는 ID 목록은 `list:<uuid>:<count>` 토큰으로 담긴다.
 */
export interface ContactAssignmentClause {
  source: string;
  value: string;
  op: '' | 'AND' | 'OR';
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
  /**
   * 엑셀에서 숨겨진 행(필터로 걸러진 행·손으로 숨긴 행)을 빼고 적재한다.
   * 미지정(과거 데이터)은 false — 숨겨진 행도 함께 적재한다.
   */
  skipHiddenRows?: boolean;
  /**
   * 엑셀에서 숨겨진 열을 읽지 않는다 — 그 열은 명단에 저장되지 않는다.
   * 미지정(과거 데이터)은 false.
   */
  skipHiddenColumns?: boolean;
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
 * surveys.contact_result_codes 가 NULL 일 때 사용되는 디폴트 14개.
 * mockup §6 의 결과코드 라디오에서 9번을 휴/폐업으로 바꾸고 13.독려를 더했다(2026-11-03 —
 * 0153 이 목록에서 사라진 옛 이름의 회차를 옮겼다 — 자기 목록에 9.전시회미참가 를 둔 설문은 그대로다).
 *
 * status 매핑:
 * - '1.조사완료' → 'positive' (응답 완료 인정)
 * - '수신거부' → 'neutral' (2026-08-27 결정 — 조사 거절 의사일 뿐 모집단 이탈이
 *   아니므로 분모 유지. 단체메일 배제는 status 무관한 수신거부 키워드 축이 담당)
 * - 나머지 12개 → 필드 생략 (= 'neutral')
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
  { code: '9.휴/폐업', label: '9.휴/폐업', order: 9, tone: 'slate' },
  { code: '10.메일발송', label: '10.메일발송', order: 10, tone: 'blue' },
  { code: '11.기타', label: '11.기타', order: 11, tone: 'amber' },
  { code: '12.담당자퇴사', label: '12.담당자퇴사', order: 12, tone: 'rose' },
  { code: '13.독려', label: '13.독려', order: 13, tone: 'slate' },
  { code: '수신거부', label: '수신거부', order: 14, tone: 'rose', status: 'neutral' },
];

/**
 * 이월 응답 임포트 확정 설정 (추적조사).
 *
 * 191개 컬럼 매핑을 한 번에 맞출 리 없어 재업로드가 정상 경로다. 사람이 화면에서 확정한
 * 것을 보관해 다시 올릴 때 재사용한다. 버전 스냅샷 밖 라이브 컬럼이다.
 */
export interface PriorAnswerImportConfig {
  /**
   * 정규화된 문항코드 → 확정 내용. 자동 제안보다 우선한다.
   *
   * 확정 시점의 문항 내용(`label`)을 함께 남긴다 — 코드만 저장하면 다음 파일에서 같은
   * 코드가 다른 문항을 가리켜도 지난 확정이 그대로 되살아나 "코드는 같은데 내용이
   * 다르다" 경고가 사라진다. 이 티켓이 막으려는 사고가 바로 그것이다.
   */
  blockMappings: Record<string, { questionId: string; label: string }>;
  /**
   * 문항 id → { 원본 값 → 선택지 저장값 }.
   * 지난 회차와 선택지 라벨이 달라진 문항에서 담당자가 그 자리에서 이어준 대응이다.
   */
  valueAliases: Record<string, Record<string, string>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 대상 정보 수정 현황 (contact_target_edit_logs.changes, 0152)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 기록 한 줄이 어떤 쓰기에서 왔는가. 마이그레이션 0152 의 CHECK 와 같은 목록이다 —
 * 늘리면 배열·스키마 check·마이그레이션 셋을 함께 고친다(AGENTS.md 주의사항 1).
 */
export const CONTACT_TARGET_EDIT_ACTIONS = [
  'info_edit',
  'attempt_edit',
  'attempt_delete',
  'assignment_change',
] as const;
export type ContactTargetEditAction = (typeof CONTACT_TARGET_EDIT_ACTIONS)[number];

/** 기록에 남기는 값 하나의 최대 글자 수. 넘으면 자르고 `*Truncated` 표식을 단다. */
export const CONTACT_TARGET_EDIT_VALUE_MAX = 1000;

/** pii 열 변경 — 값은 남기지 않는다. set=없던 값 입력 · changed=다른 값으로 · cleared=삭제 */
export type ContactTargetEditPiiOp = 'set' | 'changed' | 'cleared';

/** 컨택원 스냅샷 — 이름은 그때 이름이다(나중에 바뀌거나 지워져도 기록은 읽힌다). */
export interface ContactTargetEditAssignee {
  id: string;
  name: string;
}

/**
 * 기록에 담는 바꾸기 전 회차 — 기록 시각은 ISO 문자열(JSONB). 비고는 1,000자에서 잘려 담길 수 있고
 * 잘림 표식은 그 회차 변경(`attempt`)의 `beforeTruncated` 다.
 */
export interface ContactTargetEditAttemptSnapshot {
  resultCode: string;
  note: string | null;
  createdByEmail: string | null;
  createdAt: string;
}

/**
 * 「대상 정보 수정 현황」 한 줄 안의 변경 하나.
 *
 * - 열 이름(`label`)·컨택원 이름은 저장 시점 스냅샷이다.
 * - 값(`before`·`after`)은 null·빈 문자열을 모두 '' 로 접어 담는다(빈 값 → 빈 값은 변경이 아니다).
 *   1,000자(CONTACT_TARGET_EDIT_VALUE_MAX)를 넘으면 잘라 담고 `beforeTruncated`·`afterTruncated` 를 단다.
 * - `contactMethod` 의 값은 코드(`ContactMethod`)다 — 화면 글자는 format 이 붙인다.
 * - `attempt.after === null` 은 회차 삭제다. 회차의 `beforeTruncated`·`afterTruncated` 는 그 쪽 비고가
 *   1,000자에서 잘렸다는 뜻이다(결과코드는 자르지 않는다).
 */
export type ContactTargetEditChange =
  | {
      kind: 'attr';
      key: string;
      label: string;
      before: string;
      after: string;
      beforeTruncated?: true;
      afterTruncated?: true;
    }
  | { kind: 'pii'; key: string; label: string; op: ContactTargetEditPiiOp }
  | {
      kind: 'memo';
      before: string;
      after: string;
      beforeTruncated?: true;
      afterTruncated?: true;
    }
  | { kind: 'contactMethod'; before: string; after: string }
  | {
      kind: 'assignment';
      before: ContactTargetEditAssignee | null;
      after: ContactTargetEditAssignee | null;
    }
  | {
      kind: 'attempt';
      attemptNo: number;
      before: ContactTargetEditAttemptSnapshot;
      after: { resultCode: string; note: string | null } | null;
      beforeTruncated?: true;
      afterTruncated?: true;
    };
