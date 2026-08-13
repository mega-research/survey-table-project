import 'server-only';

import { and, asc, desc, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import { r2DeletionCandidates, type R2DeletionCandidate } from '@/db/schema';
import { gateR2Key } from '@/lib/r2-lifecycle/key-extract';

/** 수집원 트랜잭션 안에서도 등록할 수 있도록 db 또는 tx 를 받는다. */
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type R2DbExecutor = typeof db | DbTransaction;

/** 유예 기간 7일 — grilling 합의. 이 기간 안에 부활·admin 취소가 가능하다. */
export const R2_DELETION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** 수집원 식별자 — reason 과 함께 admin 큐 페이지에 노출된다. */
export type R2DeletionSource =
  | 'survey-delete'
  | 'question-delete'
  | 'library-delete'
  | 'template-delete'
  | 'save-diff'
  | 'version-prune';

export type R2DeletionCandidateStatus = 'pending' | 'cancelled' | 'kept' | 'deleted' | 'failed';

/**
 * 삭제 후보 등록. 3중 게이트(key-extract.gateR2Key)를 통과한 키만 등록하고
 * 거부 키는 rejectedKeys 로 보고한다. 같은 키의 '대기' 후보가 이미 있으면
 * partial unique(ON CONFLICT DO NOTHING)로 조용히 흡수된다.
 */
export async function registerDeletionCandidates(
  dbc: R2DbExecutor,
  input: { keys: readonly string[]; source: R2DeletionSource; reason?: string },
): Promise<{ registered: number; rejectedKeys: string[] }> {
  const accepted = new Set<string>();
  const rejectedKeys: string[] = [];
  for (const raw of input.keys) {
    const key = gateR2Key(raw);
    if (key) accepted.add(key);
    else rejectedKeys.push(raw);
  }
  if (accepted.size === 0) return { registered: 0, rejectedKeys };

  const executeAfter = new Date(Date.now() + R2_DELETION_GRACE_MS);
  const inserted = await dbc
    .insert(r2DeletionCandidates)
    .values(
      [...accepted].map((key) => ({
        key,
        source: input.source,
        reason: input.reason ?? null,
        executeAfter,
      })),
    )
    .onConflictDoNothing({
      target: r2DeletionCandidates.key,
      // partial unique index(r2_deletion_candidates_pending_key_uq) 추론용 술어
      where: sql`status = 'pending'`,
    })
    .returning({ id: r2DeletionCandidates.id });

  return { registered: inserted.length, rejectedKeys };
}

/** admin 개별 취소 — '대기' 후보만 전이한다. 성공 여부 반환. */
export async function cancelDeletionCandidate(
  id: string,
  note = '관리자 취소',
): Promise<boolean> {
  const rows = await db
    .update(r2DeletionCandidates)
    .set({ status: 'cancelled', resolvedAt: new Date(), resultNote: note })
    .where(and(eq(r2DeletionCandidates.id, id), eq(r2DeletionCandidates.status, 'pending')))
    .returning({ id: r2DeletionCandidates.id });
  return rows.length > 0;
}

/**
 * 부활 취소 — 저장되는 콘텐츠에 '대기' 후보의 키가 다시 나타나면 즉시 취소.
 * 취소된 행 수를 반환한다.
 */
export async function cancelPendingCandidatesByKeys(
  dbc: R2DbExecutor,
  keys: readonly string[],
  note = '저장 콘텐츠에 재등장 — 부활 취소',
): Promise<number> {
  if (keys.length === 0) return 0;
  const rows = await dbc
    .update(r2DeletionCandidates)
    .set({ status: 'cancelled', resolvedAt: new Date(), resultNote: note })
    .where(
      and(
        inArray(r2DeletionCandidates.key, [...keys]),
        eq(r2DeletionCandidates.status, 'pending'),
      ),
    )
    .returning({ id: r2DeletionCandidates.id });
  return rows.length;
}

/**
 * 집행자 배치 조회 — 기한이 지난 '대기' 후보를 오래된 순으로.
 * '실패' 후보도 다음 집행에서 자동 재시도한다 — 단 resolvedAt < now 조건으로
 * 같은 실행(run) 안에서 방금 실패한 행을 곧바로 재집기하지 않는다.
 */
export async function fetchDueCandidates(
  limit: number,
  now = new Date(),
): Promise<R2DeletionCandidate[]> {
  return db
    .select()
    .from(r2DeletionCandidates)
    .where(
      and(
        lte(r2DeletionCandidates.executeAfter, now),
        or(
          eq(r2DeletionCandidates.status, 'pending'),
          and(
            eq(r2DeletionCandidates.status, 'failed'),
            lt(r2DeletionCandidates.resolvedAt, now),
          ),
        ),
      ),
    )
    .orderBy(asc(r2DeletionCandidates.executeAfter), asc(r2DeletionCandidates.id))
    .limit(limit);
}

/**
 * admin 큐 페이지 조회 — 후보 목록을 registeredAt 내림차순(동률이면 id)으로 반환한다.
 * status 를 단일 값으로 주면 해당 상태만, 배열로 주면 상태들의 합집합, 생략하면 전체.
 */
export async function listDeletionCandidates(
  input: {
    status?: R2DeletionCandidateStatus | readonly R2DeletionCandidateStatus[];
    limit?: number;
  } = {},
): Promise<R2DeletionCandidate[]> {
  const { status, limit = 200 } = input;
  const where =
    status === undefined
      ? undefined
      : typeof status === 'string'
        ? eq(r2DeletionCandidates.status, status)
        : inArray(r2DeletionCandidates.status, [...status]);
  return db
    .select()
    .from(r2DeletionCandidates)
    .where(where)
    .orderBy(desc(r2DeletionCandidates.registeredAt), desc(r2DeletionCandidates.id))
    .limit(limit);
}

/**
 * 집행 대상 상태 — 이 상태의 후보만 집행자가 종결할 수 있다.
 * fetchDueCandidates 가 집는 상태와 같은 집합이어야 한다.
 */
const RESOLVABLE_STATUSES = ['pending', 'failed'] as const;

/**
 * 후보가 아직 집행 대상 상태인지 — R2 삭제 직전 재확인용.
 *
 * 배치 조회와 실제 처리 사이에는 시간이 흐른다(run 당 최대 1000건). 그 사이
 * 저장 부활이나 관리자 취소로 'cancelled' 가 된 후보의 객체를 지워버리면
 * 되돌릴 수 없으므로, 삭제 직전에 한 번 더 확인한다.
 */
export async function isCandidateResolvable(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: r2DeletionCandidates.id })
    .from(r2DeletionCandidates)
    .where(
      and(
        eq(r2DeletionCandidates.id, id),
        inArray(r2DeletionCandidates.status, [...RESOLVABLE_STATUSES]),
      ),
    );
  return rows.length > 0;
}

/**
 * 집행 결과 회계 — 집행자만 호출한다.
 *
 * 상태 가드로 pending/failed 만 전이시킨다. 배치 조회 이후 취소된 후보를
 * 덮어쓰면 취소가 조용히 무효화된다. 전이하지 못했으면 false 를 반환하니
 * 호출자는 "후보가 다른 상태로 옮겨감"으로 처리해야 한다.
 */
export async function resolveCandidate(
  id: string,
  status: Extract<R2DeletionCandidateStatus, 'kept' | 'deleted' | 'failed'>,
  resultNote: string,
): Promise<boolean> {
  const rows = await db
    .update(r2DeletionCandidates)
    .set({ status, resolvedAt: new Date(), resultNote })
    .where(
      and(
        eq(r2DeletionCandidates.id, id),
        inArray(r2DeletionCandidates.status, [...RESOLVABLE_STATUSES]),
      ),
    )
    .returning({ id: r2DeletionCandidates.id });
  return rows.length > 0;
}
