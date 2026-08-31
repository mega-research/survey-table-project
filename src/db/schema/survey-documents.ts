import { relations, sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { questionGroups, questions, surveys } from './surveys';

/**
 * 조사표 — 설문에 붙는 PDF 자료 (0097 마이그레이션).
 *
 * 설문당 여러 행을 받는 모양이다. 지금 화면은 하나만 붙이지만 '파일럿 조사표를
 * 함께 검토받는다'는 요구가 열려 있어, 컬럼 두 개로 붙였다가 나중에 테이블로
 * 옮기는 마이그레이션을 피한다.
 *
 * fileKey 는 R2 영구 네임스페이스(survey/) 의 bare 키다. 이 테이블은 R2 참조
 * 표면 SSOT 에 등재돼 있어야 파일이 유예 삭제 큐에서 사라지지 않는다
 * (lib/r2-lifecycle/reference-surface.server.ts, ADR 0015).
 *
 * 조사표는 발행 스냅샷에 넣지 않는다 — 라이브다 (ADR 0020).
 */
export const surveyDocuments = pgTable(
  'survey_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    surveyId: uuid('survey_id')
      .notNull()
      .references(() => surveys.id, { onDelete: 'cascade' }),
    fileKey: text('file_key').notNull(),
    filename: text('filename').notNull(),
    pageCount: integer('page_count').notNull(),
    order: integer('order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('survey_documents_survey_idx').on(table.surveyId, table.order)],
);

export const surveyDocumentsRelations = relations(surveyDocuments, ({ one }) => ({
  survey: one(surveys, {
    fields: [surveyDocuments.surveyId],
    references: [surveys.id],
  }),
}));

export type SurveyDocument = typeof surveyDocuments.$inferSelect;
export type NewSurveyDocument = typeof surveyDocuments.$inferInsert;

/**
 * 영역 앵커 — 조사표 쪽 위의 사각형 (0098 마이그레이션).
 *
 * 질문 하나 또는 그룹 하나에 붙고 **한 대상에 여러 개**가 붙는다. 그룹이 3쪽과
 * 4쪽에 걸치는 일이 흔한데 좌표가 쪽 단위라 사각형 하나로는 표현할 수 없다.
 *
 * 대상 참조는 nullable FK 둘 + CHECK 정확히 하나다. 종류 구분값을 저장하지 않고
 * `questionId` 가 채워졌는지로 파생한다. 다형 참조를 기각한 이유는 FK 가 없으면
 * 고아 앵커가 남아 다음 발행 때 스냅샷에 실리고 응답 화면에 유령 사각형이
 * 그려지기 때문이다.
 *
 * 좌표만 담고 R2 키를 담지 않으므로 R2 참조 표면 등재 대상이 아니다.
 */
export const surveyDocumentAnchors = pgTable(
  'survey_document_anchors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    surveyId: uuid('survey_id')
      .notNull()
      .references(() => surveys.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => surveyDocuments.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id').references(() => questions.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id').references(() => questionGroups.id, { onDelete: 'cascade' }),

    page: integer('page').notNull(),
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y').notNull(),
    w: doublePrecision('w').notNull(),
    h: doublePrecision('h').notNull(),
    order: integer('order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('survey_document_anchors_survey_idx').on(table.surveyId),
    index('survey_document_anchors_question_idx').on(table.questionId),
    index('survey_document_anchors_group_idx').on(table.groupId),
    check(
      'survey_document_anchors_owner_exactly_one',
      sql`(${table.questionId} is null) <> (${table.groupId} is null)`,
    ),
  ],
);

export const surveyDocumentAnchorsRelations = relations(surveyDocumentAnchors, ({ one }) => ({
  survey: one(surveys, {
    fields: [surveyDocumentAnchors.surveyId],
    references: [surveys.id],
  }),
  document: one(surveyDocuments, {
    fields: [surveyDocumentAnchors.documentId],
    references: [surveyDocuments.id],
  }),
}));

export type SurveyDocumentAnchor = typeof surveyDocumentAnchors.$inferSelect;
export type NewSurveyDocumentAnchor = typeof surveyDocumentAnchors.$inferInsert;
