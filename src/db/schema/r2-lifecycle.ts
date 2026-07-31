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
  // 수집원 — deletion-queue.server 의 R2DeletionSource 가 SoT
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

/**
 * 파생 참조 인덱스 — 콘텐츠에서 추출한 R2 키 참조의 캐시.
 * 유지가 아니라 재생성하는 구조다: 불변 소스(survey_versions, 캠페인 스냅샷)는
 * 삽입 시 1회 기록하고, 가변 소스는 주기적으로 전량 재추출한다.
 * 집행 판정에서 이 인덱스는 사전 필터일 뿐 삭제 권한이 없다 (spec §6.3).
 *
 * 인덱스는 수동 마이그레이션(0068) 소관:
 * - r2_key_refs_pk: (key, source_table, source_id) PK — key 선두라 키 조회를 커버
 * - r2_key_refs_source_idx: (source_table, source_id) — 행 단위 교체용
 */
export const r2KeyRefs = pgTable('r2_key_refs', {
  key: text('key').notNull(),
  sourceTable: text('source_table').notNull(),
  sourceId: uuid('source_id').notNull(),
  extractedAt: timestamp('extracted_at', { withTimezone: true }).defaultNow().notNull(),
});

export type R2DeletionCandidate = typeof r2DeletionCandidates.$inferSelect;
export type NewR2DeletionCandidate = typeof r2DeletionCandidates.$inferInsert;
export type R2SentKey = typeof r2SentKeys.$inferSelect;
export type NewR2SentKey = typeof r2SentKeys.$inferInsert;
export type R2KeyRef = typeof r2KeyRefs.$inferSelect;
export type NewR2KeyRef = typeof r2KeyRefs.$inferInsert;
