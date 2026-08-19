import { relations, sql } from 'drizzle-orm';
import { boolean, check, doublePrecision, integer, jsonb, pgTable, smallint, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { MOBILE_TABLE_DISPLAY_MODES } from '@/types/mobile-table-display';
import type { ChoiceGroup, NumberFormat, SumConstraint, SurveyLookup } from '@/types/survey';

import type {
  ContactColumnScheme,
  ContactResultCode,
  DynamicRowGroupConfig,
  GroupNameDesign,
  HeaderCell,
  PageVisit,
  ProfileColumnScheme,
  ProgressColumnScheme,
  QuestionConditionGroup,
  QuestionData,
  QuestionOption,
  QuotaConfig,
  RankingConfig,
  ResponseEditChange,
  SelectLevel,
  SurveyResponseHeaderConfig,
  SurveyVersionSnapshot,
  TableCell,
  TableColumn,
  TableRow,
  TableValidationRule,
} from './schema-types';

// 설문 테이블
export const surveys = pgTable('surveys', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description'),
  slug: text('slug').unique(),
  privateToken: uuid('private_token').defaultRandom(),
  // 공개 읽기전용 미리보기 전용 토큰 — privateToken(응답 크레덴셜)과 분리해 발급.
  // /preview/[token] 라우트만 조회한다 — /survey/[id] 응답 경로에서는 매칭하지 않는다(0069 마이그레이션).
  previewToken: uuid('preview_token').defaultRandom(),

  // 설정
  isPublic: boolean('is_public').default(true).notNull(),
  allowMultipleResponses: boolean('allow_multiple_responses').default(false).notNull(),
  showProgressBar: boolean('show_progress_bar').default(true).notNull(),
  shuffleQuestions: boolean('shuffle_questions').default(false).notNull(),
  requireLogin: boolean('require_login').default(false).notNull(),
  endDate: timestamp('end_date', { withTimezone: true }),
  // 개인정보 보관기한 — 해당일 포함 보유, KST 익일 0시 timestamp 로 저장. 경과 시 pg_cron 파기 (ADR-0012)
  piiRetentionUntil: timestamp('pii_retention_until', { withTimezone: true }),
  maxResponses: integer('max_responses'),
  thankYouMessage: text('thank_you_message').default('응답해주셔서 감사합니다!').notNull(),

  // 응답 페이지 헤더 프리셋 (0041 마이그레이션) — NULL = 기본형 폴백
  responseHeader: jsonb('response_header').$type<SurveyResponseHeaderConfig>(),

  // 컨택리스트 표시 컬럼 스킴 (slice 3 — 0014 마이그레이션)
  contactColumns: jsonb('contact_columns').$type<ContactColumnScheme>(),
  testContactColumns: jsonb('test_contact_columns').$type<ContactColumnScheme>(),

  // 설문에 복사된 LUT 사본 목록 — 외부 LUT 룩업 비교용 (T3 마이그레이션)
  lookups: jsonb('lookups').$type<SurveyLookup[]>().default([]).notNull(),

  // 결과코드 사용자 정의 (NULL = DEFAULT_RESULT_CODES 폴백, slice 3 — 0016 마이그레이션)
  contactResultCodes: jsonb('contact_result_codes').$type<ContactResultCode[]>(),

  // 진척률 표 표시 컬럼 픽커 (NULL = 4개 고정 컬럼만, slice 4 — 0017 마이그레이션)
  progressColumns: jsonb('progress_columns').$type<ProgressColumnScheme>(),

  // 응답 내역 표시 컬럼 픽커 (NULL = 기본 스킴, 0074 마이그레이션)
  profileColumns: jsonb('profile_columns').$type<ProfileColumnScheme>(),

  // 쿼터 플랜 (NULL = 쿼터 없음, 스냅샷 밖 라이브 편집 — 0045 마이그레이션)
  quotaConfig: jsonb('quota_config').$type<QuotaConfig>(),

  // 운영 제어 — 스냅샷 밖 라이브 컬럼 (quotaConfig 와 동일하게 publish 없이 즉시 반영)
  isPaused: boolean('is_paused').default(false).notNull(),
  pausedMessage: text('paused_message'),
  testModeEnabled: boolean('test_mode_enabled').default(false).notNull(),
  testToken: text('test_token'),

  // 컨택 attrs 토큰 — invite token 강제 (0022 마이그레이션)
  requireInviteToken: boolean('require_invite_token').default(false).notNull(),

  // 화면 너비 — 응답 페이지 컨테이너 항상 넓게(max-w-7xl) 강제 (0063 마이그레이션)
  forceWideLayout: boolean('force_wide_layout').default(false).notNull(),

  // 버전 관리
  status: text('status').notNull().default('draft'), // 'draft' | 'published' | 'closed'
  currentVersionId: uuid('current_version_id'), // 현재 활성 배포 버전

  // soft delete
  deletedAt: timestamp('deleted_at', { withTimezone: true }),

  contactEmail: text('contact_email'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // 0069 마이그레이션의 surveys_preview_token_unique 와 이름을 맞춘다. nullable 컬럼이라
  // NULL 행은 제약에서 제외(다중 NULL 허용) — contact_targets.invite_code(0054)와 동일 패턴.
  unique('surveys_preview_token_unique').on(table.previewToken),
]);

// 질문 그룹 테이블
export const questionGroups = pgTable('question_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  surveyId: uuid('survey_id')
    .notNull()
    .references(() => surveys.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  order: integer('order').notNull().default(0),
  parentGroupId: uuid('parent_group_id'),
  color: text('color'),
  collapsed: boolean('collapsed').default(false),
  hideName: boolean('hide_name').default(false), // 응답 페이지에서 그룹 이름(배지/소제목) 숨김 여부
  nameDesign: jsonb('name_design').$type<GroupNameDesign>(), // 루트 그룹 이름 배지 디자인 (미설정 시 기본 배지)
  displayCondition: jsonb('display_condition').$type<QuestionConditionGroup>(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// 질문 테이블
export const questions = pgTable('questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  surveyId: uuid('survey_id')
    .notNull()
    .references(() => surveys.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').references(() => questionGroups.id, { onDelete: 'set null' }),

  type: text('type').notNull(), // QuestionType 9종 — 런타임 SoT 는 @/types/question-types 의 QUESTION_TYPES
  title: text('title').notNull(),
  description: text('description'),
  required: boolean('required').default(false).notNull(),
  requiredMessage: text('required_message'), // 필수 미응답 안내 문구 — null 이면 기본 문구
  order: integer('order').notNull().default(0),

  // 옵션들 (radio, checkbox, select용) - JSON으로 저장
  options: jsonb('options').$type<QuestionOption[]>(),

  // 다단계 select용
  selectLevels: jsonb('select_levels').$type<SelectLevel[]>(),

  // 테이블 관련
  tableTitle: text('table_title'),
  tableColumns: jsonb('table_columns').$type<TableColumn[]>(),
  tableRowsData: jsonb('table_rows_data').$type<TableRow[]>(),
  tableHeaderGrid: jsonb('table_header_grid').$type<HeaderCell[][]>(),

  // 레거시 — 질문 레벨 미디어는 어디서도 읽고 쓰지 않는다(Question 타입에서 제거됨, 실DB 값 0건 확인).
  // 컬럼 자체는 비파괴 원칙으로 잔존. drop 은 별도 마이그레이션 결정 사안이며,
  // drop 시 scripts/restore-survey-from-backup.ts(gitignored)가 이 두 컬럼에 기입하므로 동시 수정 필요.
  imageUrl: text('image_url'),
  videoUrl: text('video_url'),

  // 기타 옵션
  allowOtherOption: boolean('allow_other_option').default(false),
  // 옵션 리스트 레이아웃 (undefined/1=세로, 0=가로, N≥2=N열 그리드)
  optionsColumns: integer('options_columns'),
  // 옵션 그룹 블록 정렬 (null=left, 가로/세로 배치에서만 유효)
  optionsAlign: text('options_align', { enum: ['left', 'center', 'right'] }),
  // 모바일 옵션 배치 명시 override (null=자동 휴리스틱, 0=가로, 1=세로, N≥2=그리드)
  mobileOptionsColumns: integer('mobile_options_columns'),

  // 체크박스 선택 개수 제한 (checkbox 타입 전용)
  minSelections: integer('min_selections'),
  maxSelections: integer('max_selections'),

  // 순위형(ranking) 타입 전용 설정
  rankingConfig: jsonb('ranking_config').$type<RankingConfig>(),

  // 테이블 레벨 옵션 그룹 정의 (보기 셀 묶음 - SPSS 그룹 변수/MRSET 단위)
  choiceGroups: jsonb('choice_groups').$type<ChoiceGroup[]>(),

  // 공지사항용
  noticeContent: text('notice_content'),
  requiresAcknowledgment: boolean('requires_acknowledgment').default(false),

  // 단답형(text) 타입용
  placeholder: text('placeholder'),

  // 단답형 prefill 템플릿 — 0022 마이그레이션. {{attrs_key}} 포함 가능.
  defaultValueTemplate: text('default_value_template'),

  // 단답형 숫자 입력 모드 — 0030 마이그레이션
  inputType: text('input_type'), // 'text' | 'number'
  emptyDefault: doublePrecision('empty_default'), // 숫자 모드 초기값
  // 단답형 숫자 모드 표시 포맷·범위 (콤마/단위/min/max/소수 자릿수)
  numberFormat: jsonb('number_format').$type<NumberFormat>(),

  // 단답형·장문형 개인정보 암호화 토글 — 응답값을 encryptPii 암호문으로 저장 (ADR-0012)
  piiEncrypted: boolean('pii_encrypted').default(false).notNull(),

  // SPSS 변수명 관련
  questionCode: text('question_code'), // SPSS 변수명 (예: "Q1", "Q2M1")
  isCustomSpssVarName: boolean('is_custom_spss_var_name').default(false), // 수동 편집 여부
  exportLabel: text('export_label'), // 엑셀 헤더 라벨
  spssVarType: text('spss_var_type'), // SPSS 변수 타입 오버라이드 ('Numeric' | 'String' | 'Date' | 'DateTime')
  spssMeasure: text('spss_measure'), // SPSS 측정 수준 오버라이드 ('Nominal' | 'Ordinal' | 'Continuous')

  // 열 라벨 숨기기 (테이블 타입 전용)
  hideColumnLabels: boolean('hide_column_labels').default(false),

  // 테이블 문항 내보내기 셀 순서 — 'row-first'(기본, null 동일) | 'column-first'
  exportCellOrder: text('export_cell_order').$type<'row-first' | 'column-first'>(),

  // 응답 인용 — 앞 질문의 응답을 뒤 질문 본문에 {{{이름}}} 으로 끼워넣는 기능
  answerQuoteEnabled: boolean('answer_quote_enabled'),
  answerQuoteName: text('answer_quote_name'),
  answerQuoteText: text('answer_quote_text'), // 단답형 전용. 옵션·셀 문구는 JSONB 안

  // 모바일에서도 원본 표 레이아웃(가로 스크롤)으로 표시 — 카드/스테퍼 전환 안 함
  // (테이블 타입 + 설명 테이블 소스 radio/checkbox 전용)
  mobileOriginalTable: boolean('mobile_original_table').default(false),
  mobileTableDisplayMode: text('mobile_table_display_mode', {
    enum: MOBILE_TABLE_DISPLAY_MODES,
  }).default('auto'),
  mobileDrilldownOmitLeadingColumns: integer('mobile_drilldown_omit_leading_columns').default(1),
  mobileDrilldownRepeatHeaderStartRow: integer(
    'mobile_drilldown_repeat_header_start_row',
  ).default(0),
  mobileDrilldownRepeatHeaderEndRow: integer(
    'mobile_drilldown_repeat_header_end_row',
  ).default(0),

  // 응답 페이지에서 질문 제목 숨기기 (기본 false = 표시)
  hideTitle: boolean('hide_title').default(false),

  // 응답 페이지 수동 페이지 구분점 — true면 이 질문 앞에서 새 페이지 시작
  pageBreakBefore: boolean('page_break_before').default(false),

  // 검증 규칙 및 조건부 표시
  tableValidationRules: jsonb('table_validation_rules').$type<TableValidationRule[]>(),
  dynamicRowConfigs: jsonb('dynamic_row_config').$type<DynamicRowGroupConfig[]>(),
  displayCondition: jsonb('display_condition').$type<QuestionConditionGroup>(),
  // 숫자 셀 합계 제약 (테이블 타입 전용, 차단형 검증 — tableValidationRules 와 별개)
  sumConstraints: jsonb('sum_constraints').$type<SumConstraint[]>(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check(
    'questions_mobile_table_display_mode_check',
    sql`${table.mobileTableDisplayMode} in ('auto', 'drilldown-original-row', 'row-wise-original', 'original')`,
  ),
]);

// 설문 응답 테이블
export const surveyResponses = pgTable('survey_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  surveyId: uuid('survey_id')
    .notNull()
    .references(() => surveys.id, { onDelete: 'cascade' }),

  // 응답 데이터 (질문ID -> 응답값 매핑)
  questionResponses: jsonb('question_responses').notNull().$type<Record<string, unknown>>(),

  isCompleted: boolean('is_completed').default(false).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),

  // 메타데이터
  userAgent: text('user_agent'),
  sessionId: text('session_id'),
  // 중복 감지 신호 (2026-05-27 추가)
  ipHash: text('ip_hash'),
  fpHash: text('fp_hash'),
  deviceId: text('device_id'),
  // 테스트 모드 세션이 생성한 응답 — 통계·쿼터·중복대조·export 모수에서 제외
  isTest: boolean('is_test').default(false).notNull(),
  // 미래 soft delete hook
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  // 어드민 수정 시각 (응답자 본인 흐름과 구분). NULL = 미수정.
  lastEditedAt: timestamp('last_edited_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<{
    exposedQuestionIds?: string[];
    exposedRowIds?: string[]; // 테이블 질문의 노출된 행 ID들
    [key: string]: unknown;
  }>(),

  // 버전 연결
  versionId: uuid('version_id'),

  // 운영 현황 콘솔용 추적 컬럼
  // 'in_progress' | 'completed' | 'screened_out' | 'quotaful_out' | 'bad' | 'drop'
  status: text('status').notNull().default('in_progress'),
  platform: text('platform'), // 'desktop' | 'mobile' | 'tablet'
  browser: text('browser'),
  currentStepId: text('current_step_id'), // 'group:{uuid}' | 'table:{uuid}'
  pageVisits: jsonb('page_visits').default([]).$type<PageVisit[]>(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).defaultNow().notNull(),
  totalSeconds: integer('total_seconds'),

  // 컨택 매칭 (slice 3 — 0014 마이그레이션)
  // FK 는 0014 마이그레이션의 ALTER TABLE 로 생성됨 (순환 참조 회피).
  // drizzle 에서 .references() 추가하지 말 것 — contacts.ts 와 순환 import 발생.
  contactTargetId: uuid('contact_target_id'),

  // 응답 진행률 0~100. completed=100, 그 외=계산값, 첫 답변 전=NULL
  progressPct: smallint('progress_pct'),

  // 응답자별 visible step 진척 (분기/표시조건 반영). 운영 콘솔 진행중 배지 "26/28" 표기용.
  // 응답 페이지가 첫 답변/step 이동 시 저장 (클라 계산값). 첫 답변 전·구 데이터·admin-edit=NULL.
  visibleStepIndex: smallint('visible_step_index'), // 현재 visible step 위치 (1-based)
  visibleStepTotal: smallint('visible_step_total'), // 현재까지 입력 기준 총 visible step 수

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  // 동일 (surveyId, sessionId) 의 동시 INSERT race 차단용. session_id IS NULL 행은
  // PG 의 UNIQUE-NULL 의미상 다중 허용 (의도).
  surveySessionUnique: unique('survey_responses_survey_session_unique').on(
    table.surveyId,
    table.sessionId,
  ),
  // 한 컨택에 미완료 응답은 하나만 (0014). 프로덕션에만 있던 것을 2026-08-19 스키마로 승격 —
  // 선언이 없으면 drizzle-kit push 로 만든 테스트 DB 에 제약이 빠져 realdb 검증이 무력화된다.
  activeResponsePerContact: uniqueIndex('idx_active_response_per_contact')
    .on(table.contactTargetId)
    .where(sql`${table.isCompleted} = false AND ${table.contactTargetId} IS NOT NULL`),
  // 테스트 파티션에서 한 컨택의 미삭제 응답은 하나만 (0057)
  testTargetActiveUnique: uniqueIndex('survey_responses_test_target_active_unique')
    .on(table.contactTargetId)
    .where(
      sql`${table.isTest} = true AND ${table.contactTargetId} IS NOT NULL AND ${table.deletedAt} IS NULL`,
    ),
}));

export const testResponseAttemptStatusValues = ['active', 'superseded'] as const;
export type TestResponseAttemptStatus = (typeof testResponseAttemptStatusValues)[number];

export const testResponseAttempts = pgTable(
  'test_response_attempts',
  {
    id: uuid('id').primaryKey(),
    responseId: uuid('response_id')
      .notNull()
      .references(() => surveyResponses.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').notNull(),
    status: text('status').$type<TestResponseAttemptStatus>().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (table) => ({
    activeResponseUnique: uniqueIndex('test_response_attempts_active_response_unique')
      .on(table.responseId)
      .where(sql`${table.status} = 'active'`),
  }),
);

// 설문 버전 스냅샷 테이블
export const surveyVersions = pgTable('survey_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  surveyId: uuid('survey_id')
    .notNull()
    .references(() => surveys.id, { onDelete: 'cascade' }),

  versionNumber: integer('version_number').notNull(),
  status: text('status').notNull().default('published'), // 'published' | 'superseded' | 'closed'

  // 배포 시점의 전체 설문 구조 (불변 — 수정 금지).
  // NULL = 버전 보존 정책으로 정리됨 (2026-07-31 spec). 읽는 쪽은 NULL 을 다뤄야 한다.
  snapshot: jsonb('snapshot').$type<SurveyVersionSnapshot>(),

  changeNote: text('change_note'),
  publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),

  // 보존 정책으로 snapshot 을 비운 시각. NULL = 정리되지 않음.
  prunedAt: timestamp('pruned_at', { withTimezone: true }),

  // soft delete
  deletedAt: timestamp('deleted_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  // 설문당 버전 번호 유일 (0004). 프로덕션에만 있던 것을 2026-08-19 스키마로 승격.
  surveyVersionUnique: uniqueIndex('idx_survey_versions_survey_version').on(
    table.surveyId,
    table.versionNumber,
  ),
}));

// 관리자 응답 수정 audit 이력 (단건 편집 수정/편집 현황 카드용).
// survey_responses 1:N. 관리자 saveAdminEdit 1회당 행 1개.
// 초기화(action:'reset') 마커는 응답 물리 삭제와 함께 남기므로 responseId 가
// null 이고 contactTargetId 로만 연결된다 (0072).
export const responseEditLogs = pgTable('response_edit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  responseId: uuid('response_id').references(() => surveyResponses.id, {
    onDelete: 'cascade',
  }),
  // FK 는 순환 import 회피로 마이그레이션 ALTER 로만 생성 (contact_targets cascade)
  contactTargetId: uuid('contact_target_id'),
  action: text('action')
    .$type<'edit' | 'reset' | 'reedit_allow'>()
    .notNull()
    .default('edit'),
  surveyId: uuid('survey_id')
    .notNull()
    .references(() => surveys.id, { onDelete: 'cascade' }),
  // 수정한 관리자. authed 보장이나 방어적으로 nullable.
  editedBy: text('edited_by'),
  // 스냅샷 — 계정 삭제돼도 누구였는지 보존.
  editorEmail: text('editor_email'),
  changedQuestions: jsonb('changed_questions')
    .$type<ResponseEditChange[]>()
    .notNull()
    .default([]),
  changedCount: integer('changed_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 정규화된 응답 테이블
export const responseAnswers = pgTable('response_answers', {
  id: uuid('id').primaryKey().defaultRandom(),
  responseId: uuid('response_id')
    .notNull()
    .references(() => surveyResponses.id, { onDelete: 'cascade' }),
  questionId: uuid('question_id').notNull(),

  // 값 저장 (타입별 분리)
  textValue: text('text_value'),
  arrayValue: jsonb('array_value').$type<string[]>(),
  objectValue: jsonb('object_value').$type<Record<string, unknown>>(),

  // 역정규화 (빠른 필터링)
  questionType: text('question_type').notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 질문 보관함 테이블
export const savedQuestions = pgTable('saved_questions', {
  id: uuid('id').primaryKey().defaultRandom(),

  // 질문 데이터
  question: jsonb('question').notNull().$type<QuestionData>(),

  // 메타데이터
  name: text('name').notNull(),
  description: text('description'),
  tags: jsonb('tags').$type<string[]>().default([]),
  category: text('category').notNull(),
  usageCount: integer('usage_count').default(0).notNull(),
  isPreset: boolean('is_preset').default(false).notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// LUT 보관함 테이블
export const savedLookups = pgTable('saved_lookups', {
  id: uuid('id').primaryKey().defaultRandom(),

  // 메타데이터
  name: text('name').notNull(),
  description: text('description'),
  tags: jsonb('tags').$type<string[]>().default([]).notNull(),
  category: text('category').notNull(),

  // LUT 데이터 — 키/값 구분은 조건 에디터에서만 한다. LUT 는 컬럼 + 행만 보유.
  columns: jsonb('columns').$type<string[]>().notNull(),
  rows: jsonb('rows').$type<Array<Record<string, string | number>>>().default([]).notNull(),

  usageCount: integer('usage_count').default(0).notNull(),
  isPreset: boolean('is_preset').default(false).notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type SavedLookupRow = typeof savedLookups.$inferSelect;
export type NewSavedLookupRow = typeof savedLookups.$inferInsert;

// 셀 보관함 테이블
export const savedCells = pgTable('saved_cells', {
  id: uuid('id').primaryKey().defaultRandom(),

  // 셀 데이터 (위치/이미지 정보 제거됨)
  cell: jsonb('cell').notNull().$type<TableCell>(),

  // 메타데이터
  name: text('name').notNull(),
  cellType: text('cell_type').notNull(), // 'text'|'checkbox'|'radio'|'select'|'input'|'video'
  usageCount: integer('usage_count').default(0).notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// 질문 카테고리 테이블
export const questionCategories = pgTable('question_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  color: text('color').notNull(),
  icon: text('icon'),
  order: integer('order').notNull().default(0),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ========================
// Relations 정의
// ========================

export const surveysRelations = relations(surveys, ({ many }) => ({
  questions: many(questions),
  groups: many(questionGroups),
  responses: many(surveyResponses),
  versions: many(surveyVersions),
}));

export const questionsRelations = relations(questions, ({ one }) => ({
  survey: one(surveys, {
    fields: [questions.surveyId],
    references: [surveys.id],
  }),
  group: one(questionGroups, {
    fields: [questions.groupId],
    references: [questionGroups.id],
  }),
}));

export const questionGroupsRelations = relations(questionGroups, ({ one, many }) => ({
  survey: one(surveys, {
    fields: [questionGroups.surveyId],
    references: [surveys.id],
  }),
  parentGroup: one(questionGroups, {
    fields: [questionGroups.parentGroupId],
    references: [questionGroups.id],
    relationName: 'childGroups',
  }),
  childGroups: many(questionGroups, {
    relationName: 'childGroups',
  }),
  questions: many(questions),
}));

export const surveyResponsesRelations = relations(surveyResponses, ({ one, many }) => ({
  survey: one(surveys, {
    fields: [surveyResponses.surveyId],
    references: [surveys.id],
  }),
  version: one(surveyVersions, {
    fields: [surveyResponses.versionId],
    references: [surveyVersions.id],
  }),
  answers: many(responseAnswers),
}));

export const surveyVersionsRelations = relations(surveyVersions, ({ one, many }) => ({
  survey: one(surveys, {
    fields: [surveyVersions.surveyId],
    references: [surveys.id],
  }),
  responses: many(surveyResponses),
}));

export const responseAnswersRelations = relations(responseAnswers, ({ one }) => ({
  response: one(surveyResponses, {
    fields: [responseAnswers.responseId],
    references: [surveyResponses.id],
  }),
}));

// ========================
// 타입 추론 (Drizzle)
// ========================
export type Survey = typeof surveys.$inferSelect;
export type NewSurvey = typeof surveys.$inferInsert;

export type QuestionGroup = typeof questionGroups.$inferSelect;
export type NewQuestionGroup = typeof questionGroups.$inferInsert;

export type Question = typeof questions.$inferSelect;
export type NewQuestion = typeof questions.$inferInsert;

export type SurveyResponse = typeof surveyResponses.$inferSelect;
export type NewSurveyResponse = typeof surveyResponses.$inferInsert;
export type TestResponseAttempt = typeof testResponseAttempts.$inferSelect;
export type NewTestResponseAttempt = typeof testResponseAttempts.$inferInsert;

export type SavedQuestion = typeof savedQuestions.$inferSelect;
export type NewSavedQuestion = typeof savedQuestions.$inferInsert;

export type SavedCellRow = typeof savedCells.$inferSelect;
export type NewSavedCell = typeof savedCells.$inferInsert;

export type QuestionCategory = typeof questionCategories.$inferSelect;
export type NewQuestionCategory = typeof questionCategories.$inferInsert;

export type SurveyVersion = typeof surveyVersions.$inferSelect;
export type NewSurveyVersion = typeof surveyVersions.$inferInsert;

export type ResponseAnswer = typeof responseAnswers.$inferSelect;
export type NewResponseAnswer = typeof responseAnswers.$inferInsert;

export type ResponseEditLog = typeof responseEditLogs.$inferSelect;
export type NewResponseEditLog = typeof responseEditLogs.$inferInsert;
