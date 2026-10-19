import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import type {
  ContactAssignmentClause,
  ContactUploadMapping,
  ContactUploadMode,
} from '@/shared/contracts/contacts';

import { surveyResponses, surveys } from './surveys';

export const contactUploads = pgTable('contact_uploads', {
  id: uuid('id').primaryKey().defaultRandom(),
  surveyId: uuid('survey_id')
    .notNull()
    .references(() => surveys.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  uploadedRows: integer('uploaded_rows').notNull().default(0),
  mergedRows: integer('merged_rows').notNull().default(0),
  errorRows: integer('error_rows').notNull().default(0),
  mode: text('mode').notNull().default('replace').$type<ContactUploadMode>(),
  skippedRows: integer('skipped_rows').notNull().default(0),
  mapping: jsonb('mapping').$type<ContactUploadMapping>().notNull(),
  uploadedBy: uuid('uploaded_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * 컨택원 — 조사 대상을 나눠 맡기는 이름 붙은 배정 묶음 (0136). 계정이 아니다.
 * 실데이터·테스트 데이터에 따로 있고(is_test), 같은 설문·파티션 안에서 이름이 겹치지 않는다.
 * lastClauses 는 마지막으로 교체 적용한 조건 — 컨택원 수정 화면을 다시 열면 채운다.
 */
export const contactAssignments = pgTable(
  'contact_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    surveyId: uuid('survey_id')
      .notNull()
      .references(() => surveys.id, { onDelete: 'cascade' }),
    isTest: boolean('is_test').notNull().default(false),
    name: text('name').notNull(),
    order: integer('order').notNull().default(0),
    lastClauses: jsonb('last_clauses').$type<ContactAssignmentClause[]>(),
    lastAppliedAt: timestamp('last_applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    surveyScopeNameUnique: unique('contact_assignments_survey_scope_name_unique').on(
      table.surveyId,
      table.isTest,
      table.name,
    ),
  }),
);

export const contactTargets = pgTable(
  'contact_targets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    surveyId: uuid('survey_id')
      .notNull()
      .references(() => surveys.id, { onDelete: 'cascade' }),
    resid: integer('resid').notNull(),
    isTest: boolean('is_test').notNull().default(false),
    groupValue: text('group_value'),
    inviteToken: uuid('invite_token').defaultRandom().notNull(),
    inviteCode: text('invite_code').notNull(),
    unsubscribeToken: uuid('unsubscribe_token').defaultRandom().notNull(),
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
    attrs: jsonb('attrs').$type<Record<string, string>>().notNull().default({}),
    uploadId: uuid('upload_id').references(() => contactUploads.id, { onDelete: 'set null' }),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    responseId: uuid('response_id').references(() => surveyResponses.id, { onDelete: 'set null' }),
    memo: text('memo'),
    contactMethod: text('contact_method'),
    /** 지금 맡은 컨택원 (0136). 컨택원을 지우면 배정 없음(NULL)이 된다. */
    assignmentId: uuid('assignment_id').references(() => contactAssignments.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    assignmentIdx: index('contact_targets_assignment_idx')
      .on(table.assignmentId)
      .where(sql`${table.assignmentId} IS NOT NULL`),
    surveyScopeResidUnique: unique('contact_targets_survey_scope_resid_unique').on(
      table.surveyId,
      table.isTest,
      table.resid,
    ),
    inviteTokenUnique: unique('contact_targets_invite_token_unique').on(table.inviteToken),
    inviteCodeUnique: unique('contact_targets_invite_code_unique').on(table.inviteCode),
    unsubscribeTokenUnique: unique('contact_targets_unsubscribe_token_unique').on(
      table.unsubscribeToken,
    ),
  }),
);

export const contactPii = pgTable(
  'contact_pii',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactTargetId: uuid('contact_target_id')
      .notNull()
      .references(() => contactTargets.id, { onDelete: 'cascade' }),
    fieldType: text('field_type').notNull(),
    columnKey: text('column_key').notNull(),
    cipher: text('cipher').notNull(),
    blindIndex: text('blind_index').notNull(),
    maskHint: text('mask_hint'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    targetColumnUnique: unique('contact_pii_target_column_unique').on(
      table.contactTargetId,
      table.columnKey,
    ),
  }),
);

export const contactPriorAnswers = pgTable(
  'contact_prior_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactTargetId: uuid('contact_target_id')
      .notNull()
      .references(() => contactTargets.id, { onDelete: 'cascade' }),
    // 응답 저장 형태(surveyResponses.questionResponses)와 동형인 이월 응답 한 벌.
    // 표·복수선택·랭킹이 별도 변환 없이 들어가고 기타/상세 기재 사이드카도 함께 담긴다.
    answers: jsonb('answers').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // 조사 대상 하나당 한 벌 — 회차 축 없음(직전 1회차만 보관).
    targetUnique: unique('contact_prior_answers_target_unique').on(table.contactTargetId),
  }),
);

export const contactAttempts = pgTable(
  'contact_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactTargetId: uuid('contact_target_id')
      .notNull()
      .references(() => contactTargets.id, { onDelete: 'cascade' }),
    attemptNo: integer('attempt_no').notNull(),
    resultCode: text('result_code').notNull(),
    note: text('note'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    targetNoUnique: unique('contact_attempts_target_no_unique').on(
      table.contactTargetId,
      table.attemptNo,
    ),
  }),
);

/**
 * 저장된 ID 목록 — 필터 붙여넣기 대용량 경로 (0084).
 * 시스템ID/attrs 컬럼 검색의 인라인 상한(2,000개)을 넘는 목록을 저장하고 URL 에는
 * `list:<uuid>` 토큰만 싣는다. 캠페인 filterSnapshot 이 토큰을 보존하므로 만료·정리 없음
 * (설문 삭제 시 cascade). ids 는 중복 제거·오름차순 정수 배열.
 */
export const contactIdLists = pgTable(
  'contact_id_lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    surveyId: uuid('survey_id')
      .notNull()
      .references(() => surveys.id, { onDelete: 'cascade' }),
    ids: jsonb('ids').$type<number[]>().notNull(),
    idCount: integer('id_count').notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    surveyIdx: index('contact_id_lists_survey_idx').on(table.surveyId),
  }),
);

// ─────────── relations ───────────

export const contactUploadsRelations = relations(contactUploads, ({ one, many }) => ({
  survey: one(surveys, {
    fields: [contactUploads.surveyId],
    references: [surveys.id],
  }),
  targets: many(contactTargets),
}));

export const contactTargetsRelations = relations(contactTargets, ({ one, many }) => ({
  survey: one(surveys, {
    fields: [contactTargets.surveyId],
    references: [surveys.id],
  }),
  upload: one(contactUploads, {
    fields: [contactTargets.uploadId],
    references: [contactUploads.id],
  }),
  response: one(surveyResponses, {
    fields: [contactTargets.responseId],
    references: [surveyResponses.id],
  }),
  attempts: many(contactAttempts),
  pii: many(contactPii),
  priorAnswers: many(contactPriorAnswers),
}));

export const contactPiiRelations = relations(contactPii, ({ one }) => ({
  target: one(contactTargets, {
    fields: [contactPii.contactTargetId],
    references: [contactTargets.id],
  }),
}));

export const contactPriorAnswersRelations = relations(contactPriorAnswers, ({ one }) => ({
  target: one(contactTargets, {
    fields: [contactPriorAnswers.contactTargetId],
    references: [contactTargets.id],
  }),
}));

export const contactAttemptsRelations = relations(contactAttempts, ({ one }) => ({
  target: one(contactTargets, {
    fields: [contactAttempts.contactTargetId],
    references: [contactTargets.id],
  }),
}));

// surveyResponses 의 reverse relation. 순환 import 회피 위해
// surveys.ts 가 아닌 contacts.ts 에서 정의.
// drizzle 은 같은 schema namespace 안의 relations 를 모두 머지하므로 OK.
// (relations.js extractTablesRelationalConfig 가 relationName 키로 머지 — 검증 완료.)
export const surveyResponsesContactRelations = relations(surveyResponses, ({ one }) => ({
  contactTarget: one(contactTargets, {
    fields: [surveyResponses.contactTargetId],
    references: [contactTargets.id],
  }),
}));

// 타입 export
export type ContactUpload = typeof contactUploads.$inferSelect;
export type NewContactUpload = typeof contactUploads.$inferInsert;
export type ContactTarget = typeof contactTargets.$inferSelect;
export type NewContactTarget = typeof contactTargets.$inferInsert;
export type ContactAttempt = typeof contactAttempts.$inferSelect;
export type NewContactAttempt = typeof contactAttempts.$inferInsert;
export type ContactPii = typeof contactPii.$inferSelect;
export type NewContactPii = typeof contactPii.$inferInsert;
export type ContactPriorAnswers = typeof contactPriorAnswers.$inferSelect;
export type ContactAssignment = typeof contactAssignments.$inferSelect;
export type NewContactPriorAnswers = typeof contactPriorAnswers.$inferInsert;
