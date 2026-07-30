import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * R2 파일 수명주기 — 유예 삭제 큐 + 발송 장부. (CONTEXT.md "파일(R2) 수명주기")
 *
 * 인덱스는 수동 마이그레이션(0065) 소관:
 * - r2_deletion_candidates_pending_key_uq: (key) WHERE status='pending' partial unique
 * - r2_deletion_candidates_due_idx: (execute_after) WHERE status='pending'
 */

/**
 * 삭제 후보 큐. R2 영구 객체 삭제의 유일한 경로 — 등록 후 7일 유예를 거쳐
 * 집행자(Inngest cron)가 장부·전역 참조 재확인을 통과한 키만 지운다.
 * status: pending(대기) | cancelled(취소됨) | kept(보존됨) | deleted(삭제됨) | failed(실패)
 */
export const r2DeletionCandidates = pgTable('r2_deletion_candidates', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull(),
  // 수집원: survey-delete | question-delete | library-delete | template-delete | save-diff | admin
  source: text('source').notNull(),
  // 사람이 읽는 사유 (어떤 엔티티/저장에서 왔는지)
  reason: text('reason'),
  status: text('status').notNull().default('pending'),
  registeredAt: timestamp('registered_at', { withTimezone: true }).defaultNow().notNull(),
  executeAfter: timestamp('execute_after', { withTimezone: true }).notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resultNote: text('result_note'),
});

/**
 * 발송 장부 — 발송된 메일 콘텐츠에서 추출한 R2 키의 append-only 기록.
 * 장부에 오른 키는 참조 유무와 무관하게 영구 보존된다 (수신함 참조는 DB 로
 * 복원 불가). 어떤 경로도 행을 지우지 않는다.
 */
export const r2SentKeys = pgTable('r2_sent_keys', {
  key: text('key').primaryKey(),
  firstSentAt: timestamp('first_sent_at', { withTimezone: true }).defaultNow().notNull(),
});

export type R2DeletionCandidate = typeof r2DeletionCandidates.$inferSelect;
export type NewR2DeletionCandidate = typeof r2DeletionCandidates.$inferInsert;
export type R2SentKey = typeof r2SentKeys.$inferSelect;
export type NewR2SentKey = typeof r2SentKeys.$inferInsert;
