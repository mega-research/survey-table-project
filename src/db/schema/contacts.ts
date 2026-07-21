import { relations } from 'drizzle-orm';
import { integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { surveys, surveyResponses } from './surveys';
import type { ContactUploadMapping } from './schema-types';

export const contactUploads = pgTable('contact_uploads', {
  id: uuid('id').primaryKey().defaultRandom(),
  surveyId: uuid('survey_id')
    .notNull()
    .references(() => surveys.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  uploadedRows: integer('uploaded_rows').notNull().default(0),
  mergedRows: integer('merged_rows').notNull().default(0),
  errorRows: integer('error_rows').notNull().default(0),
  mapping: jsonb('mapping').$type<ContactUploadMapping>().notNull(),
  uploadedBy: uuid('uploaded_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const contactTargets = pgTable(
  'contact_targets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    surveyId: uuid('survey_id')
      .notNull()
      .references(() => surveys.id, { onDelete: 'cascade' }),
    resid: integer('resid').notNull(),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    surveyResidUnique: unique('contact_targets_survey_resid_unique').on(table.surveyId, table.resid),
    inviteTokenUnique: unique('contact_targets_invite_token_unique').on(table.inviteToken),
    inviteCodeUnique: unique('contact_targets_invite_code_unique').on(table.inviteCode),
    unsubscribeTokenUnique: unique('contact_targets_unsubscribe_token_unique').on(table.unsubscribeToken),
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
    targetNoUnique: unique('contact_attempts_target_no_unique').on(table.contactTargetId, table.attemptNo),
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
}));

export const contactPiiRelations = relations(contactPii, ({ one }) => ({
  target: one(contactTargets, {
    fields: [contactPii.contactTargetId],
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
