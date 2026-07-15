import { relations } from 'drizzle-orm';
import { boolean, doublePrecision, integer, jsonb, pgTable, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import type { ChoiceGroup, SurveyLookup } from '@/types/survey';

import type {
  ContactColumnScheme,
  ContactResultCode,
  DynamicRowGroupConfig,
  GroupNameDesign,
  HeaderCell,
  PageVisit,
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

  // 설문에 복사된 LUT 사본 목록 — 외부 LUT 룩업 비교용 (T3 마이그레이션)
  lookups: jsonb('lookups').$type<SurveyLookup[]>().default([]).notNull(),

  // 결과코드 사용자 정의 (NULL = DEFAULT_RESULT_CODES 폴백, slice 3 — 0016 마이그레이션)
  contactResultCodes: jsonb('contact_result_codes').$type<ContactResultCode[]>(),

  // 진척률 표 표시 컬럼 픽커 (NULL = 4개 고정 컬럼만, slice 4 — 0017 마이그레이션)
  progressColumns: jsonb('progress_columns').$type<ProgressColumnScheme>(),

  // 쿼터 플랜 (NULL = 쿼터 없음, 스냅샷 밖 라이브 편집 — 0045 마이그레이션)
  quotaConfig: jsonb('quota_config').$type<QuotaConfig>(),

  // 운영 제어 — 스냅샷 밖 라이브 컬럼 (quotaConfig 와 동일하게 publish 없이 즉시 반영)
  isPaused: boolean('is_paused').default(false).notNull(),
  pausedMessage: text('paused_message'),
  testModeEnabled: boolean('test_mode_enabled').default(false).notNull(),
  testToken: uuid('test_token'),

  // 컨택 attrs 토큰 — invite token 강제 (0022 마이그레이션)
  requireInviteToken: boolean('require_invite_token').default(false).notNull(),

  // 버전 관리
  status: text('status').notNull().default('draft'), // 'draft' | 'published' | 'closed'
  currentVersionId: uuid('current_version_id'), // 현재 활성 배포 버전

  // soft delete
  deletedAt: timestamp('deleted_at', { withTimezone: true }),

  contactEmail: text('contact_email'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

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

  // 응답 페이지에서 질문 제목 숨기기 (기본 false = 표시)
  hideTitle: boolean('hide_title').default(false),

  // 응답 페이지 수동 페이지 구분점 — true면 이 질문 앞에서 새 페이지 시작
  pageBreakBefore: boolean('page_break_before').default(false),

  // 검증 규칙 및 조건부 표시
  tableValidationRules: jsonb('table_validation_rules').$type<TableValidationRule[]>(),
  dynamicRowConfigs: jsonb('dynamic_row_config').$type<DynamicRowGroupConfig[]>(),
  displayCondition: jsonb('display_condition').$type<QuestionConditionGroup>(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

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
}));

// 설문 버전 스냅샷 테이블
export const surveyVersions = pgTable('survey_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  surveyId: uuid('survey_id')
    .notNull()
    .references(() => surveys.id, { onDelete: 'cascade' }),

  versionNumber: integer('version_number').notNull(),
  status: text('status').notNull().default('published'), // 'published' | 'superseded' | 'closed'

  // 배포 시점의 전체 설문 구조 (불변 — 수정 금지)
  snapshot: jsonb('snapshot').notNull().$type<SurveyVersionSnapshot>(),

  changeNote: text('change_note'),
  publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),

  // soft delete
  deletedAt: timestamp('deleted_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 관리자 응답 수정 audit 이력 (단건 편집 수정/편집 현황 카드용).
// survey_responses 1:N. 관리자 saveAdminEdit 1회당 행 1개.
export const responseEditLogs = pgTable('response_edit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  responseId: uuid('response_id')
    .notNull()
    .references(() => surveyResponses.id, { onDelete: 'cascade' }),
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
