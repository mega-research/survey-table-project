import { relations } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { surveys } from './surveys';

/**
 * 조사표 — 설문에 붙는 PDF 자료 (0084 마이그레이션).
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
