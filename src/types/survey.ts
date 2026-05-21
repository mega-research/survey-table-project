export type QuestionType =
  | 'text'
  | 'textarea'
  | 'radio'
  | 'checkbox'
  | 'select'
  | 'multiselect'
  | 'ranking'
  | 'table'
  | 'notice';

// 순위형 질문 설정
export interface RankingConfig {
  positions: number; // 매길 순위 개수 (1~10, 기본 3)
  allowDuplicateRanks?: boolean; // 중복 선택 허용 (기본 false)
  requireAllPositions?: boolean; // 모든 순위 입력 필수 (기본 false, required 와 별도)
  // 옵션 소스:
  // - 'manual' (기본): question.options 직접 입력
  // - 'table': 이 질문 자신의 tableRowsData 내 ranking_opt(rnk) 셀이 옵션 소스. 질문 안에 설명 테이블 내장 가능
  optionsSource?: 'manual' | 'table';
  // branchRule 판정 기준 순위 (기본 1 — 1순위로 선택된 옵션 기준으로 분기 평가).
  branchRankPosition?: number;
  // 1/2/3... 순위 드롭다운 배치 — getOptionsLayout 과 동일한 의미.
  // undefined/1 = 세로 1열(기본) / 0 = 가로(wrap) / N ≥ 2 = N열 그리드.
  // 일반 options 레이아웃(question.optionsColumns) 과 분리.
  positionsColumns?: number;
}

// 순위형 응답 단일 항목
export interface RankingAnswer {
  rank: number; // 1-based
  optionValue: string; // Case 1: 옵션 value / Case 2: ranking_opt 셀의 cellId / 기타: '__other__'
  /** @deprecated Phase 7. optionText 사용. '__other__' 매직값은 마이그레이션에서 실제 옵션 ID 로 변환됨. */
  otherText?: string;
  /** allowTextInput 옵션이 이 순위에 선택된 경우 사용자가 입력한 텍스트 */
  optionText?: string;
}

// 분기 동작 타입
export type BranchAction = 'goto' | 'end';

// 분기 규칙
export interface BranchRule {
  id: string;
  value: string; // 응답 값 (radio value, checkbox value, select value, table cell value 등)
  action: BranchAction;
  targetQuestionId?: string; // action이 'goto'일 때 이동할 질문 ID
}

// 테이블 검증 규칙 타입
export type TableValidationType =
  | 'exclusive-check' // 특정 행만 체크된 경우 (예: "~만 있는 경우")
  | 'required-combination' // 특정 조합이 체크된 경우
  | 'any-of' // 여러 행 중 하나라도 체크된 경우
  | 'all-of' // 특정 행들이 모두 체크된 경우
  | 'none-of'; // 특정 행들이 모두 체크 안된 경우

// 테이블 검증 규칙
export interface TableValidationRule {
  id: string;
  type: TableValidationType;
  description?: string; // 규칙 설명
  conditions: {
    checkType: 'checkbox' | 'radio' | 'select' | 'input'; // 체크할 셀 타입
    rowIds: string[]; // 체크할 행 ID들
    cellColumnIndex?: number; // 체크할 열 인덱스 (선택사항, 없으면 모든 열 확인)
    expectedValues?: string[]; // 기대하는 값들 (select, radio, input용)
  };
  additionalConditions?: {
    cellColumnIndex: number; // 추가로 확인할 열 인덱스
    checkType: 'checkbox' | 'radio' | 'select' | 'input';
    rowIds?: string[]; // 특정 행만 확인 (없으면 메인 조건의 체크된 행 사용)
    expectedValues?: string[]; // 기대하는 값들
  };
  action: BranchAction;
  targetQuestionId?: string; // 기본 타겟 (targetQuestionMap이 없을 때 사용)
  targetQuestionMap?: Record<string, string>; // { "디지털 TV": "question-id-1", "UHD TV": "question-id-2" }
  errorMessage?: string; // 조건 미충족 시 표시할 메시지
}

// 질문 표시 조건 논리 타입
export type ConditionLogicType = 'AND' | 'OR' | 'NOT';

// 질문 표시 조건
export interface QuestionCondition {
  id: string;
  name?: string; // 조건 이름 (선택사항)
  sourceQuestionId: string; // 조건을 확인할 질문 ID
  conditionType: 'value-match' | 'table-cell-check' | 'custom'; // 조건 타입
  // value-match: 특정 값과 일치하는지 확인 (radio, select 등)
  requiredValues?: string[]; // 필요한 값들
  // table-cell-check: 테이블의 특정 셀이 체크되었는지 확인
  tableConditions?: {
    rowIds: string[]; // 체크 확인할 행 ID들
    cellColumnIndex?: number; // 체크할 열 인덱스
    checkType: 'any' | 'all' | 'none'; // any: 하나라도, all: 모두, none: 모두 아님
    expectedValues?: string[]; // 기대하는 값들 (checkbox, radio, select 옵션의 value)
  };
  additionalConditions?: {
    cellColumnIndex: number; // 추가로 확인할 열 인덱스
    checkType: 'checkbox' | 'radio' | 'select' | 'input';
    rowIds?: string[]; // 특정 행만 확인 (없으면 메인 조건의 체크된 행 사용)
    expectedValues?: string[]; // 기대하는 값들
  };
  logicType: ConditionLogicType; // 여러 조건 결합 시
  enabled?: boolean; // 조건 활성화 여부 (기본값: true)
}

// 질문 표시 조건 그룹 (여러 조건 조합)
export interface QuestionConditionGroup {
  conditions: QuestionCondition[];
  logicType: ConditionLogicType; // 조건들을 AND/OR로 결합
}

export interface QuestionOption {
  id: string;
  label: string;
  value: string;
  optionCode?: string; // 엑셀 내보내기용 옵션 코드 (예: "1", "01")
  spssNumericCode?: number; // SPSS 숫자코드 (옵션 생성 시 할당, 순서 변경해도 유지)
  isCustomOptionCode?: boolean; // 사용자가 수동 편집한 옵션코드인지 여부
  /**
   * 선택 시 사이드카 텍스트 입력 받기.
   * 빌더의 "+ 텍스트 옵션 추가" 버튼으로 생성된 옵션은 true.
   * SPSS export 시 `{questionVar}_{변수번호}_text` 라는 STRING 변수가 자동 생성됨.
   */
  allowTextInput?: boolean;
  /** @deprecated Phase 7 cleanup 에서 제거. allowTextInput 사용. */
  hasOther?: boolean;
  // 조건부 분기
  branchRule?: BranchRule;
}

export interface TableCell {
  id: string;
  cellCode?: string; // ✨ 셀 코드 (예: "Q4-1_r1_c1") — 자동생성 또는 수동 입력
  isCustomCellCode?: boolean; // 사용자가 수동 편집한 셀코드인지 여부
  exportLabel?: string; // ✨ 엑셀 열 이름 (예: "가구TV보유_TV종류_UHD")
  isCustomExportLabel?: boolean; // 사용자가 수동 편집한 라벨인지 여부
  // SPSS 변수 타입 / 측정 수준 (셀 단위)
  spssVarType?: 'Numeric' | 'String' | 'Date' | 'DateTime';
  spssMeasure?: 'Nominal' | 'Ordinal' | 'Continuous';
  // SPSS 숫자코드 (ranking_opt 셀이 Case 2 옵션 소스로 쓰일 때 사용. 비어있으면 1-based 인덱스 자동)
  spssNumericCode?: number;
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
    | 'ranking' // Case 3: 셀 내부 랭킹 (셀별 옵션 + 순위 드롭다운 N개)
    | 'ranking_opt'; // Case 2: 이 셀이 질문 레벨 ranking 의 옵션 소스로 사용됨
  // 체크박스/라디오 버튼 관련 속성
  checkboxOptions?: CheckboxOption[];
  radioOptions?: RadioOption[];
  radioGroupName?: string; // 라디오 버튼 그룹명
  // select 관련 속성
  selectOptions?: QuestionOption[];
  allowOtherOption?: boolean; // 기타 옵션 허용 여부 (ranking 셀에서도 재사용)
  // 셀 내부 옵션 리스트 배치 (radio/checkbox/ranking 셀 공통)
  // undefined/1 = 세로 1열(기본) / 0 = 가로 한 줄(wrap) / N ≥ 2 = N열 그리드
  optionsColumns?: number;
  // input 관련 속성
  placeholder?: string; // 단문형 입력 필드 placeholder
  inputMaxLength?: number; // 단문형 입력 필드 최대 길이
  // input 셀 prefill 템플릿 — {{attrs_key}} 포함 가능
  defaultValueTemplate?: string;
  // 체크박스 선택 개수 제한 (체크박스 타입 셀 전용)
  minSelections?: number; // 최소 선택 개수
  maxSelections?: number; // 최대 선택 개수
  // 순위형 셀 (type='ranking') — 셀 자체가 독립 랭킹 질문
  rankingConfig?: RankingConfig;
  rankingOptions?: QuestionOption[]; // 셀별 옵션 리스트
  // SPSS 변수명 접미사 템플릿 (기본 '_rk{k}').
  // {k} 는 rank 번호(1-based)로 치환. 예: '_rk{k}' → _rk1/_rk2, '_rnk{k}' → _rnk1/_rnk2
  // SPSS 변수명은 대소문자 미구분이므로 소문자 권장.
  rankSuffixPattern?: string;
  // 각 순위별 SPSS 변수명 수동 오버라이드 (배열 index = rank-1).
  // 특정 항목이 비어있으면 rankSuffixPattern 기반 자동 생성으로 폴백.
  rankVarNames?: string[];
  // ranking_opt 셀 (type='ranking_opt') — Case 2 의 옵션 소스로 쓰일 때의 라벨
  // 이미지/비디오 셀이면 필수, 텍스트 셀이면 비워두고 content 평문을 자동 사용
  rankingLabel?: string;
  // ranking_opt 셀 전용: 이 셀을 랭킹 질문의 "기타 (직접 입력)" 엔트리로 사용.
  // 선택 시 RankingAnswer.optionValue='__other__' + otherText 자유입력 저장.
  // 질문 당 최대 1개.
  isOtherRankingCell?: boolean;
  // 셀 병합 관련 속성
  rowspan?: number; // 행 병합 (세로)
  colspan?: number; // 열 병합 (가로)
  isHidden?: boolean; // rowspan/colspan으로 인해 숨겨진 셀인지 여부
  // 셀 컨텐츠 정렬 관련 속성
  horizontalAlign?: 'left' | 'center' | 'right'; // 가로 정렬 (기본값: left)
  verticalAlign?: 'top' | 'middle' | 'bottom'; // 세로 정렬 (기본값: top)
  // 셀 텍스트(content) 위치 — input/checkbox/radio/select/ranking 셀에서 텍스트와 입력 영역의 상대 위치
  // 기본값(undefined)은 'top' 과 동일 — 기존 동작 유지
  textPosition?: 'top' | 'bottom' | 'left' | 'right';
  // 런타임 전용: 셀렉터 경계에서 분리된 continuation 셀 마커
  _isContinuation?: boolean;
}

export interface CheckboxOption {
  id: string;
  label: string;
  value: string;
  optionCode?: string; // 엑셀 내보내기용 옵션 코드
  spssNumericCode?: number; // SPSS 숫자코드
  isCustomOptionCode?: boolean; // 사용자가 수동 편집한 옵션코드인지 여부
  checked?: boolean;
  /**
   * 선택 시 사이드카 텍스트 입력 받기.
   * 빌더의 "+ 텍스트 옵션 추가" 버튼으로 생성된 옵션은 true.
   * SPSS export 시 `{questionVar}_{변수번호}_text` 라는 STRING 변수가 자동 생성됨.
   */
  allowTextInput?: boolean;
  /** @deprecated Phase 7 cleanup 에서 제거. allowTextInput 사용. */
  hasOther?: boolean;
  // 조건부 분기
  branchRule?: BranchRule;
}

export interface RadioOption {
  id: string;
  label: string;
  value: string;
  optionCode?: string; // 엑셀 내보내기용 옵션 코드
  spssNumericCode?: number; // SPSS 숫자코드
  isCustomOptionCode?: boolean; // 사용자가 수동 편집한 옵션코드인지 여부
  selected?: boolean;
  /**
   * 선택 시 사이드카 텍스트 입력 받기.
   * 빌더의 "+ 텍스트 옵션 추가" 버튼으로 생성된 옵션은 true.
   * SPSS export 시 `{questionVar}_{변수번호}_text` 라는 STRING 변수가 자동 생성됨.
   */
  allowTextInput?: boolean;
  /** @deprecated Phase 7 cleanup 에서 제거. allowTextInput 사용. */
  hasOther?: boolean;
  // 조건부 분기
  branchRule?: BranchRule;
}

export interface TableRow {
  id: string;
  rowCode?: string; // ✨ 엑셀 내보내기용 행 코드 (예: "UHD", "DIGITAL", "r1")
  label: string;
  cells: TableCell[];
  height?: number; // 행 높이 (픽셀 단위)
  minHeight?: number; // 최소 높이
  displayCondition?: QuestionConditionGroup; // 행 표시 조건
  dynamicGroupId?: string; // 소속 동적 그룹 ID (undefined = 항상 표시)
  showWhenDynamicGroupId?: string; // 이 그룹에 선택 있으면 함께 표시 (소계 행용)
}

// 동적 행 그룹 설정
export interface DynamicRowGroupConfig {
  groupId: string; // 그룹 고유 ID
  enabled: boolean;
  label?: string; // 선택 버튼 텍스트 (기본: "항목 선택")
  insertAfterRowId?: string; // 이 행 다음에 선택 버튼 배치 (미지정 시 헤더 바로 아래)
  buttonAlign?: 'left' | 'center' | 'right'; // 버튼 정렬 (기본: 'left')
  displayCondition?: QuestionConditionGroup; // 그룹 레벨 조건부 표시
}

export interface TableColumn {
  id: string;
  columnCode?: string; // ✨ 엑셀 내보내기용 열 코드
  label: string;
  width?: number; // 열 너비 (픽셀 단위)
  minWidth?: number; // 최소 너비
  // 컬럼 헤더 병합 관련 속성
  colspan?: number; // 헤더 가로 병합
  isHeaderHidden?: boolean; // 다른 컬럼의 colspan에 의해 숨겨진 헤더
  displayCondition?: QuestionConditionGroup; // 열 표시 조건
}

// 다단계 헤더 셀 (headerGrid용)
export interface HeaderCell {
  id: string;
  label: string;
  colspan: number; // 가로 병합 (기본 1)
  rowspan: number; // 세로 병합 (기본 1)
}

export interface SelectLevel {
  id: string;
  label: string;
  placeholder?: string;
  order: number;
  options: QuestionOption[];
}

// 질문 그룹 (2단계 계층 구조 지원)
export interface QuestionGroup {
  id: string;
  surveyId: string; // 소속 설문 ID
  name: string; // 그룹 이름 (예: "공통", "응답자 정보", "1번", "III. 지상파 직접 수신")
  description?: string; // 그룹 설명
  order: number; // 그룹 순서
  parentGroupId?: string; // 상위 그룹 ID (하위 그룹인 경우)
  color?: string; // 그룹 색상 (UI용)
  collapsed?: boolean; // 접힘 상태 (UI용)
  displayCondition?: QuestionConditionGroup; // 그룹 표시 조건
}

export interface Question {
  id: string;
  questionCode?: string; // ✨ SPSS 변수명 (예: "Q1", "Q2M1", "Q1_U1_R0_C0")
  isCustomSpssVarName?: boolean; // ✨ 수동 편집 여부 (true면 자동 재할당 시 보존)
  exportLabel?: string; // ✨ 엑셀 헤더용 라벨 (예: "성별", "TV보유현황")
  type: QuestionType;
  title: string;
  description?: string;
  required: boolean;
  groupId?: string; // 소속 그룹 ID (QuestionGroup의 id 참조)
  options?: QuestionOption[];
  selectLevels?: SelectLevel[]; // 다단계 select용
  tableRows?: string[];
  tableCols?: string[];
  tableType?: string; // ✨ 테이블 타입 (매트릭스 등) - "matrix", "loop" 등
  loopConfig?: any; // ✨ 반복 질문 설정

  // 새로운 테이블 구조
  tableTitle?: string;
  tableColumns?: TableColumn[];
  tableRowsData?: TableRow[];
  tableHeaderGrid?: HeaderCell[][]; // 다단계 헤더 그리드 (없으면 tableColumns로 단일 행 폴백)
  imageUrl?: string;
  videoUrl?: string;
  order: number;
  allowOtherOption?: boolean; // 기타 옵션 허용 여부 (radio, checkbox, select용)
  // 옵션 리스트 렌더 방식 (radio/checkbox/ranking 공통)
  // undefined 또는 1 = 세로 1열(기본) / 0 = 가로 한 줄(wrap) / N ≥ 2 = N열 그리드
  optionsColumns?: number;
  // 체크박스 선택 개수 제한 (checkbox 타입 전용)
  minSelections?: number; // 최소 선택 개수
  maxSelections?: number; // 최대 선택 개수
  // 순위형(ranking) 타입 전용. optionsSource='table' 이면 Case 2 (tableRowsData 의 ranking_opt 셀을 옵션으로)
  rankingConfig?: RankingConfig;
  // 공지사항(notice) 타입용
  noticeContent?: string; // TipTap HTML 콘텐츠
  requiresAcknowledgment?: boolean; // 이해했다는 체크 필요 여부
  // 단답형(text) 타입용
  placeholder?: string; // 입력 필드 placeholder
  // 단답형 prefill 템플릿 — {{attrs_key}} 포함 가능. (0022 마이그레이션)
  defaultValueTemplate?: string | null;
  // 테이블 검증 규칙 (테이블 타입 전용)
  tableValidationRules?: TableValidationRule[];
  // 동적 행 그룹 설정 (테이블 타입 전용)
  dynamicRowConfigs?: DynamicRowGroupConfig[];
  // 열 라벨 숨기기 (테이블 타입 전용, UI에서만 숨기고 데이터는 보존)
  hideColumnLabels?: boolean;
  // 질문 표시 조건 (이 질문을 표시하기 위한 조건)
  displayCondition?: QuestionConditionGroup;
  // SPSS .sav 내보내기 오버라이드 (없으면 질문 타입 기반 자동 판단)
  spssVarType?: 'Numeric' | 'String' | 'Date' | 'DateTime';
  spssMeasure?: 'Nominal' | 'Ordinal' | 'Continuous';
}

export interface Survey {
  id: string;
  title: string;
  description?: string;
  slug?: string; // 공개 설문용 커스텀 URL 슬러그
  privateToken?: string; // 비공개 설문용 보안 토큰 (UUID)
  status?: string; // draft | published
  currentVersionId?: string | null; // 현재 배포된 버전 ID
  groups?: QuestionGroup[]; // 질문 그룹 목록
  questions: Question[];
  settings: SurveySettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface SurveySettings {
  isPublic: boolean;
  allowMultipleResponses: boolean;
  showProgressBar: boolean;
  shuffleQuestions: boolean;
  requireLogin: boolean;
  endDate?: Date;
  maxResponses?: number;
  thankYouMessage: string;
  // 컨택 attrs 토큰 — invite token 강제 (0022 마이그레이션)
  requireInviteToken?: boolean;
}

// 기타 옵션 입력값 처리를 위한 타입
export interface OtherInputValue {
  optionId: string;
  inputValue: string;
}

// 설문 응답데이터 타입 (단일 질문 응답)
export interface SurveyResponse {
  questionId: string;
  value: string | string[] | { [key: string]: string | string[] | object };
  /**
   * 옵션 단위 사이드카 텍스트 입력.
   * key = optionId, value = 사용자가 입력한 텍스트.
   * 응답 제출 시점에 "선택된" 옵션의 텍스트만 남기고 나머지는 drop (filterOptionTextsForSubmission).
   */
  optionTexts?: Record<string, string>;
  /** @deprecated Phase 7 cleanup. optionTexts 사용. 마이그레이션 호환용. */
  otherInputs?: OtherInputValue[];
}

// 설문 제출 데이터 타입 (DB 레코드)
export interface SurveySubmission {
  id: string;
  surveyId: string;
  sessionId?: string | null;
  startedAt: Date;
  completedAt?: Date | null;
  isCompleted: boolean;
  currentGroupOrder: number;
  questionResponses: Record<string, any>; // JSON 저장된 응답들 (questionId -> value)
  userAgent?: string | null;
  ipAddress?: string | null;
  updatedAt: Date;
}

export interface QuestionTypeInfo {
  type: QuestionType;
  label: string;
  icon: string;
  description: string;
  color: string;
}

// 보관함 (라이브러리용)
export interface SavedQuestion {
  id: string;
  question: Question;
  name: string; // 사용자가 지정한 이름 (예: "성별 질문", "연령대 선택")
  description?: string; // 설명
  tags: string[]; // 태그 (예: ["인구통계", "기본정보"])
  category: string; // 카테고리 (예: "인구통계", "만족도", "NPS")
  usageCount: number; // 사용 횟수
  isPreset: boolean; // 프리셋 질문 여부
  createdAt: Date;
  updatedAt: Date;
}

// 셀 보관함
export interface SavedCell {
  id: string;
  cell: TableCell;
  name: string;
  cellType: TableCell['type'];
  usageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// 질문 카테고리
export interface QuestionCategory {
  id: string;
  name: string;
  color: string;
  icon?: string;
  order: number;
}

// 기본 카테고리 목록
export const DEFAULT_CATEGORIES: QuestionCategory[] = [
  {
    id: 'demographics',
    name: '인구통계',
    color: 'bg-blue-100 text-blue-600',
    icon: 'Users',
    order: 0,
  },
  {
    id: 'satisfaction',
    name: '만족도',
    color: 'bg-green-100 text-green-600',
    icon: 'ThumbsUp',
    order: 1,
  },
  { id: 'nps', name: 'NPS', color: 'bg-purple-100 text-purple-600', icon: 'TrendingUp', order: 2 },
  {
    id: 'feedback',
    name: '피드백',
    color: 'bg-orange-100 text-orange-600',
    icon: 'MessageSquare',
    order: 3,
  },
  { id: 'preference', name: '선호도', color: 'bg-pink-100 text-pink-600', icon: 'Heart', order: 4 },
  {
    id: 'custom',
    name: '사용자 정의',
    color: 'bg-gray-100 text-gray-600',
    icon: 'Folder',
    order: 5,
  },
];
