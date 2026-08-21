/**
 * 유예 삭제 큐·발송 장부 서비스 — 실DB 왕복 계약 테스트.
 *
 * 계약 (이슈 03):
 * - 등록: 3중 게이트 거부 키(tmp/외부/네임스페이스 밖)는 등록되지 않는다
 * - 등록: 같은 키의 '대기' 후보 중복 등록은 partial unique 로 흡수된다
 * - 취소: '대기' 후보만 '취소됨'으로 전이된다
 * - 종결: 집행자는 '대기'·'실패' 후보만 종결한다 — 배치 조회 이후 취소된
 *   후보를 덮어쓰면 취소가 조용히 무효화된다
 * - 장부: append-only — 중복 기록은 무시되고 최초 발송 시각이 보존된다
 *
 * 실행: pnpm test:integration (로컬 supabase 54322 + 0065 마이그레이션 적용 필요)
 */
import { inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { r2DeletionCandidates, r2SentKeys } from '@/db/schema';
import {
  R2_DELETION_GRACE_MS,
  cancelDeletionCandidate,
  cancelPendingCandidatesByKeys,
  isCandidateResolvable,
  registerDeletionCandidates,
  resolveCandidate,
} from '@/server/shared/r2-lifecycle/deletion-queue.server';
import { getLedgeredKeys, recordSentKeys } from '@/server/shared/r2-lifecycle/sent-ledger.server';

const isLocalDb =
  (process.env['DATABASE_URL'] ?? '').includes('127.0.0.1') ||
  (process.env['DATABASE_URL'] ?? '').includes('localhost');

const testKey = (ns: string) => `${ns}/rt-${crypto.randomUUID()}.png`;
const createdKeys: string[] = [];
const track = (k: string) => {
  createdKeys.push(k);
  return k;
};

describe.skipIf(!isLocalDb)('유예 삭제 큐·발송 장부 실DB 왕복', () => {
  afterAll(async () => {
    if (createdKeys.length > 0) {
      await db.delete(r2DeletionCandidates).where(inArray(r2DeletionCandidates.key, createdKeys));
      await db.delete(r2SentKeys).where(inArray(r2SentKeys.key, createdKeys));
    }
  });

  it('등록: 게이트 거부 키는 등록되지 않고 rejectedKeys 로 보고된다', async () => {
    const valid = track(testKey('mail'));
    const result = await registerDeletionCandidates(db, {
      keys: [valid, 'tmp/mail/x.png', 'images/legacy.webp', 'mail/../escape.png', ''],
      source: 'save-diff',
      reason: '게이트 테스트',
    });
    expect(result.registered).toBe(1);
    expect(result.rejectedKeys.sort()).toEqual(
      ['', 'images/legacy.webp', 'mail/../escape.png', 'tmp/mail/x.png'].sort(),
    );

    const rows = await db
      .select()
      .from(r2DeletionCandidates)
      .where(inArray(r2DeletionCandidates.key, [valid]));
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe('pending');
    expect(rows[0]?.source).toBe('save-diff');
    // 집행 예정 = 등록 + 7일 (분 단위 오차 허용)
    const delta = (rows[0]?.executeAfter.getTime() ?? 0) - Date.now();
    expect(delta).toBeGreaterThan(R2_DELETION_GRACE_MS - 60_000);
    expect(delta).toBeLessThan(R2_DELETION_GRACE_MS + 60_000);
  });

  it('등록: 같은 키의 대기 후보 중복 등록은 흡수된다 — 대기 행 1개 유지', async () => {
    const key = track(testKey('survey'));
    const first = await registerDeletionCandidates(db, { keys: [key], source: 'survey-delete' });
    const second = await registerDeletionCandidates(db, { keys: [key], source: 'save-diff' });
    expect(first.registered).toBe(1);
    expect(second.registered).toBe(0);

    const rows = await db
      .select()
      .from(r2DeletionCandidates)
      .where(inArray(r2DeletionCandidates.key, [key]));
    expect(rows.length).toBe(1);
    expect(rows[0]?.source).toBe('survey-delete');
  });

  it('취소: 대기 후보가 취소됨으로 전이되고, 이미 취소된 후보 재취소는 false', async () => {
    const key = track(testKey('mail-attachment'));
    await registerDeletionCandidates(db, { keys: [key], source: 'template-delete' });
    const [row] = await db
      .select()
      .from(r2DeletionCandidates)
      .where(inArray(r2DeletionCandidates.key, [key]));
    if (!row) throw new Error('등록된 후보를 찾지 못했다');

    expect(await cancelDeletionCandidate(row.id)).toBe(true);
    const [after] = await db
      .select()
      .from(r2DeletionCandidates)
      .where(inArray(r2DeletionCandidates.key, [key]));
    expect(after?.status).toBe('cancelled');
    expect(after?.resolvedAt).not.toBeNull();

    expect(await cancelDeletionCandidate(row.id)).toBe(false);
  });

  it('종결: 취소된 후보는 집행 대상이 아니며 종결로 덮어써지지 않는다', async () => {
    const key = track(testKey('mail'));
    await registerDeletionCandidates(db, { keys: [key], source: 'save-diff' });
    const [row] = await db
      .select()
      .from(r2DeletionCandidates)
      .where(inArray(r2DeletionCandidates.key, [key]));
    if (!row) throw new Error('등록된 후보를 찾지 못했다');

    expect(await isCandidateResolvable(row.id)).toBe(true);

    // 배치 조회 이후 부활·관리자 취소가 들어온 상황
    expect(await cancelDeletionCandidate(row.id)).toBe(true);

    expect(await isCandidateResolvable(row.id)).toBe(false);
    expect(await resolveCandidate(row.id, 'deleted', 'R2 삭제 후 HEAD 검증 완료')).toBe(false);

    const [after] = await db
      .select()
      .from(r2DeletionCandidates)
      .where(inArray(r2DeletionCandidates.key, [key]));
    expect(after?.status).toBe('cancelled');
  });

  it('종결: 실패 후보는 다음 집행에서 다시 종결할 수 있다', async () => {
    const key = track(testKey('mail'));
    await registerDeletionCandidates(db, { keys: [key], source: 'save-diff' });
    const [row] = await db
      .select()
      .from(r2DeletionCandidates)
      .where(inArray(r2DeletionCandidates.key, [key]));
    if (!row) throw new Error('등록된 후보를 찾지 못했다');

    expect(await resolveCandidate(row.id, 'failed', 'HEAD 검증 실패')).toBe(true);
    expect(await isCandidateResolvable(row.id)).toBe(true);
    expect(await resolveCandidate(row.id, 'deleted', '재시도 성공')).toBe(true);

    const [after] = await db
      .select()
      .from(r2DeletionCandidates)
      .where(inArray(r2DeletionCandidates.key, [key]));
    expect(after?.status).toBe('deleted');
  });

  it('부활 취소: 키 목록으로 대기 후보를 일괄 취소한다', async () => {
    const k1 = track(testKey('notice-attachment'));
    const k2 = track(testKey('mail'));
    await registerDeletionCandidates(db, { keys: [k1, k2], source: 'save-diff' });

    const cancelled = await cancelPendingCandidatesByKeys(db, [k1, k2, 'mail/없는키.png']);
    expect(cancelled).toBe(2);

    const rows = await db
      .select()
      .from(r2DeletionCandidates)
      .where(inArray(r2DeletionCandidates.key, [k1, k2]));
    expect(rows.every((r) => r.status === 'cancelled')).toBe(true);

    // 취소 후 같은 키 재등록은 새 대기 후보를 만든다 (partial unique 는 대기만 대상)
    const re = await registerDeletionCandidates(db, { keys: [k1], source: 'save-diff' });
    expect(re.registered).toBe(1);
  });

  it('장부: 중복 기록은 무시되고 최초 발송 시각이 보존된다, tmp 키는 기록되지 않는다', async () => {
    const key = track(testKey('mail'));
    const first = await recordSentKeys(db, [key, key, 'tmp/mail-attachment/t.pdf']);
    expect(first).toBe(1);

    const [before] = await db.select().from(r2SentKeys).where(inArray(r2SentKeys.key, [key]));
    if (!before) throw new Error('장부 기록을 찾지 못했다');

    const second = await recordSentKeys(db, [key]);
    expect(second).toBe(0);
    const [after] = await db.select().from(r2SentKeys).where(inArray(r2SentKeys.key, [key]));
    expect(after?.firstSentAt.getTime()).toBe(before.firstSentAt.getTime());

    const tmpRows = await db
      .select()
      .from(r2SentKeys)
      .where(inArray(r2SentKeys.key, ['tmp/mail-attachment/t.pdf']));
    expect(tmpRows.length).toBe(0);

    const ledgered = await getLedgeredKeys([key, 'mail/미기록.png']);
    expect(ledgered.has(key)).toBe(true);
    expect(ledgered.has('mail/미기록.png')).toBe(false);
  });
});
