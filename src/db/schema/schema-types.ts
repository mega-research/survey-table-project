// JSONB 컬럼에 사용되는 내부 타입 정의
// 테이블 정의의 $type<>() 제네릭에서 참조됨

// 버전 스냅샷 타입
export interface SurveyVersionSnapshot {
  title: string;
  description?: string;
  questions: QuestionData[];
  groups: QuestionGroupData[];
  settings: {
    isPublic: boolean;
    allowMultipleResponses: boolean;
    showProgressBar: boolean;
    shuffleQuestions: boolean;
    requireLogin: boolean;
    endDate?: string;
    maxResponses?: number;
    thankYouMessage: string;
  };
}

export interface QuestionGroupData {
  id: string;
  surveyId: string;
  name: string;
  description?: string;
  order: number;
  parentGroupId?: string;
  color?: string;
  collapsed?: boolean;
  displayCondition?: QuestionConditionGroup;
}

// 분기 규칙
export interface BranchRule {
  id: string;
  value: string;
  action: 'goto' | 'end';
  targetQuestionId?: string;
}

// 질문 옵션
export interface QuestionOption {
  id: string;
  label: string;
  value: string;
  hasOther?: boolean;
  branchRule?: BranchRule;
}

// 다단계 select 레벨
export interface SelectLevel {
  id: string;
  label: string;
  placeholder?: string;
  order: number;
  options: QuestionOption[];
}

// 순위형 질문 설정
export interface RankingConfig {
  positions: number;
  allowDuplicateRanks?: boolean;
  requireAllPositions?: boolean;
  optionsSource?: 'manual' | 'table';
  positionsColumns?: number;
}

// 체크박스 옵션
export interface CheckboxOption {
  id: string;
  label: string;
  value: string;
  checked?: boolean;
  hasOther?: boolean;
  branchRule?: BranchRule;
}

// 라디오 옵션
export interface RadioOption {
  id: string;
  label: string;
  value: string;
  selected?: boolean;
  hasOther?: boolean;
  branchRule?: BranchRule;
}

// 테이블 셀
export interface TableCell {
  id: string;
  content: string;
  imageUrl?: string;
  videoUrl?: string;
  type:
    | 'text'
    | 'image'
    | 'video'
    | 'checkbox'
    | 'radio'
    | 'select'
    | 'input'
    | 'ranking'
    | 'ranking_opt';
  checkboxOptions?: CheckboxOption[];
  radioOptions?: RadioOption[];
  radioGroupName?: string;
  selectOptions?: QuestionOption[];
  allowOtherOption?: boolean;
  optionsColumns?: number;
  placeholder?: string;
  inputMaxLength?: number;
  minSelections?: number;
  maxSelections?: number;
  rowspan?: number;
  colspan?: number;
  isHidden?: boolean;
  horizontalAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  // 순위형 셀 (type='ranking')
  rankingConfig?: RankingConfig;
  rankingOptions?: QuestionOption[];
  // ranking_opt 셀 (type='ranking_opt') — Case 2 옵션 소스용 라벨
  rankingLabel?: string;
  isOtherRankingCell?: boolean;
}

// 테이블 행
export interface TableRow {
  id: string;
  label: string;
  cells: TableCell[];
  height?: number;
  minHeight?: number;
}

// 테이블 열
export interface TableColumn {
  id: string;
  label: string;
  width?: number;
  minWidth?: number;
}

// 다단계 헤더 셀
export interface HeaderCell {
  id: string;
  label: string;
  colspan: number;
  rowspan: number;
}

// 테이블 검증 규칙
export interface TableValidationRule {
  id: string;
  type: 'exclusive-check' | 'required-combination' | 'any-of' | 'all-of' | 'none-of';
  description?: string;
  conditions: {
    checkType: 'checkbox' | 'radio' | 'select' | 'input';
    rowIds: string[];
    cellColumnIndex?: number;
    expectedValues?: string[];
  };
  additionalConditions?: {
    cellColumnIndex: number;
    checkType: 'checkbox' | 'radio' | 'select' | 'input';
    rowIds?: string[];
    expectedValues?: string[];
  };
  action: 'goto' | 'end';
  targetQuestionId?: string;
  targetQuestionMap?: Record<string, string>;
  errorMessage?: string;
}

// 질문 표시 조건
export interface QuestionCondition {
  id: string;
  name?: string;
  sourceQuestionId: string;
  conditionType: 'value-match' | 'table-cell-check' | 'custom';
  requiredValues?: string[];
  tableConditions?: {
    rowIds: string[];
    cellColumnIndex?: number;
    checkType: 'any' | 'all' | 'none';
    expectedValues?: string[];
  };
  additionalConditions?: {
    cellColumnIndex: number;
    checkType: 'checkbox' | 'radio' | 'select' | 'input';
    rowIds?: string[];
    expectedValues?: string[];
  };
  logicType: 'AND' | 'OR' | 'NOT';
  enabled?: boolean;
}

export interface DynamicRowGroupConfig {
  groupId: string;
  enabled: boolean;
  label?: string;
  insertAfterRowId?: string;
  buttonAlign?: 'left' | 'center' | 'right';
}

export interface QuestionConditionGroup {
  conditions: QuestionCondition[];
  logicType: 'AND' | 'OR' | 'NOT';
}

// 운영 현황 콘솔 — 응답 페이지 방문 기록
export interface PageVisit {
  stepId: string;
  enteredAt: string;
  leftAt?: string;
}

// 보관함용 질문 데이터
export interface QuestionData {
  id: string;
  type: string;
  title: string;
  description?: string;
  required: boolean;
  groupId?: string;
  options?: QuestionOption[];
  selectLevels?: SelectLevel[];
  tableTitle?: string;
  tableColumns?: TableColumn[];
  tableRowsData?: TableRow[];
  tableHeaderGrid?: HeaderCell[][];
  imageUrl?: string;
  videoUrl?: string;
  order: number;
  allowOtherOption?: boolean;
  optionsColumns?: number;
  minSelections?: number;
  maxSelections?: number;
  noticeContent?: string;
  requiresAcknowledgment?: boolean;
  placeholder?: string;
  tableValidationRules?: TableValidationRule[];
  hideColumnLabels?: boolean;
  displayCondition?: QuestionConditionGroup;
  rankingConfig?: RankingConfig;
}

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
    | 'system.contact_owner';
  order: number;
  /** 숨김 (운영 컬럼 일부는 hide 불가 — UI 가드) */
  hidden?: boolean;
}

/** surveys.progress_columns — 진척률 표 (Report 탭) 그룹 메타 컬럼 픽커 */
export interface ProgressColumnScheme {
  version: number;
  columns: ProgressColumnDef[];
}

export interface ProgressColumnDef {
  /** attrs 키 (예: '개최 월', '개최기간'). source 는 항상 attrs.<key> — system.* 제외. */
  key: string;
  /** 표 헤더 라벨 (사용자 편집 가능). 컨택리스트 라벨과 별도. */
  label: string;
  order: number;
  hidden?: boolean;
}

/** contact_uploads.mapping — 엑셀 업로드 매핑 결과 (시나리오 B 단순화) */
export interface ContactUploadMapping {
  /** 시스템 필드 → 엑셀 0-based 컬럼 인덱스. group 만 필수. */
  systemFields: {
    group: number;
    email?: number;
    biz?: number;
    name?: number;
    company?: number;
    phone?: number;
  };
  /** 사용자가 컨택리스트에 표시하기로 토글한 attrs 키 (헤더명) 목록. 나머지는 hidden 으로 자동 등록. */
  selectedAttrsKeys: string[];
  /** 자동 감지된 시스템 필드 (UI 표시용 — 사용자가 수동 조정 가능). */
  autoDetected?: {
    email?: number;
    biz?: number;
    phone?: number;
    group?: number;
  };
  /** 1-based, 디폴트 1 */
  headerRow: number;
  /** 사용자가 선택한 시트 이름 (디폴트 첫 시트) */
  sheetName: string;
  /**
   * @deprecated 시나리오 B 에서 머지 제거 — backward compat 용 optional.
   * 본 슬라이스 후속에서는 무시됨.
   */
  mergeKey?: 'email+biz' | 'email' | 'biz';
  /**
   * @deprecated 시나리오 B 에서 머지 제거 — backward compat 용 optional.
   */
  mergeKeyPolicy?: 'either' | 'both';
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
}

/**
 * surveys.contact_result_codes 가 NULL 일 때 사용되는 디폴트 13개.
 * mockup §6 의 결과코드 라디오 그대로.
 */
export const DEFAULT_RESULT_CODES: ContactResultCode[] = [
  { code: '1.조사완료',     label: '1.조사완료',     order: 1,  tone: 'green' },
  { code: '2.재통화예약',   label: '2.재통화예약',   order: 2,  tone: 'blue' },
  { code: '3.비수신',       label: '3.비수신',       order: 3,  tone: 'slate' },
  { code: '4.부재',         label: '4.부재',         order: 4,  tone: 'slate' },
  { code: '5.출장',         label: '5.출장',         order: 5,  tone: 'slate' },
  { code: '6.거절',         label: '6.거절',         order: 6,  tone: 'rose' },
  { code: '7.결번·번호오류', label: '7.결번·번호오류', order: 7,  tone: 'rose' },
  { code: '8.중복',         label: '8.중복',         order: 8,  tone: 'slate' },
  { code: '9.전시회미참가', label: '9.전시회미참가', order: 9,  tone: 'slate' },
  { code: '10.메일발송',    label: '10.메일발송',    order: 10, tone: 'blue' },
  { code: '11.기타',        label: '11.기타',        order: 11, tone: 'amber' },
  { code: '12.담당자퇴사',  label: '12.담당자퇴사',  order: 12, tone: 'rose' },
  { code: '수신거부',       label: '수신거부',       order: 13, tone: 'rose' },
];

// ─────────────────────────────────────────────────────────────────────────────
// 메일 (mail_templates) 관련 JSONB 타입
// ─────────────────────────────────────────────────────────────────────────────

/** mail_templates.attachments 의 각 원소 */
export interface MailAttachment {
  /** R2 object key — 예: mail/<surveyId>/<uuid>.pdf */
  key: string;
  filename: string;
  size: number;   // bytes
  mime: string;
}
