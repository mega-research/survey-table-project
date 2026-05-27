import { relations } from 'drizzle-orm';
import { boolean, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import type { SurveyLookup } from '@/types/survey';

import type {
  ContactColumnScheme,
  ContactResultCode,
  DynamicRowGroupConfig,
  HeaderCell,
  PageVisit,
  ProgressColumnScheme,
  QuestionConditionGroup,
  QuestionData,
  QuestionOption,
  RankingConfig,
  SelectLevel,
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
  maxResponses: integer('max_responses'),
  thankYouMessage: text('thank_you_message').default('응답해주셔서 감사합니다!').notNull(),

  // 컨택리스트 표시 컬럼 스킴 (slice 3 — 0014 마이그레이션)
  contactColumns: jsonb('contact_columns').$type<ContactColumnScheme>(),

  // 설문에 복사된 LUT 사본 목록 — 외부 LUT 룩업 비교용 (T3 마이그레이션)
  lookups: jsonb('lookups').$type<SurveyLookup[]>().default([]).notNull(),

  // 결과코드 사용자 정의 (NULL = DEFAULT_RESULT_CODES 폴백, slice 3 — 0016 마이그레이션)
  contactResultCodes: jsonb('contact_result_codes').$type<ContactResultCode[]>(),

  // 진척률 표 표시 컬럼 픽커 (NULL = 4개 고정 컬럼만, slice 4 — 0017 마이그레이션)
  progressColumns: jsonb('progress_columns').$type<ProgressColumnScheme>(),

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

  type: text('type').notNull(), // 'text' | 'textarea' | 'radio' | 'checkbox' | 'select' | 'multiselect' | 'table' | 'notice'
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

  // 미디어
  imageUrl: text('image_url'),
  videoUrl: text('video_url'),

  // 기타 옵션
  allowOtherOption: boolean('allow_other_option').default(false),
  // 옵션 리스트 레이아웃 (undefined/1=세로, 0=가로, N≥2=N열 그리드)
  optionsColumns: integer('options_columns'),

  // 체크박스 선택 개수 제한 (checkbox 타입 전용)
  minSelections: integer('min_selections'),
  maxSelections: integer('max_selections'),

  // 순위형(ranking) 타입 전용 설정
  rankingConfig: jsonb('ranking_config').$type<RankingConfig>(),

  // 공지사항용
  noticeContent: text('notice_content'),
  requiresAcknowledgment: boolean('requires_acknowledgment').default(false),

  // 단답형(text) 타입용
  placeholder: text('placeholder'),

  // 단답형 prefill 템플릿 — 0022 마이그레이션. {{attrs_key}} 포함 가능.
  defaultValueTemplate: text('default_value_template'),

  // SPSS 변수명 관련
  questionCode: text('question_code'), // SPSS 변수명 (예: "Q1", "Q2M1")
  isCustomSpssVarName: boolean('is_custom_spss_var_name').default(false), // 수동 편집 여부
  exportLabel: text('export_label'), // 엑셀 헤더 라벨
  spssVarType: text('spss_var_type'), // SPSS 변수 타입 오버라이드 ('Numeric' | 'String' | 'Date' | 'DateTime')
  spssMeasure: text('spss_measure'), // SPSS 측정 수준 오버라이드 ('Nominal' | 'Ordinal' | 'Continuous')

  // 열 라벨 숨기기 (테이블 타입 전용)
  hideColumnLabels: boolean('hide_column_labels').default(false),

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
  ipAddress: text('ip_address'),
  sessionId: text('session_id'),
  // 중복 감지 신호 (2026-05-27 추가)
  ipHash: text('ip_hash'),
  fpHash: text('fp_hash'),
  deviceId: text('device_id'),
  // 미래 soft delete hook
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
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
