import { sql, type SQL } from 'drizzle-orm';

import { db } from '@/db';

/**
 * 실DB 경합 테스트 전용 — 잠금을 쥔 트랜잭션 뒤에 줄 선 요청을 센다.
 *
 * 경합 테스트는 「잠금을 쥔 채 경쟁자들이 그 잠금을 기다리게 한 뒤 놓는다」. 기다리는지를 DB 전체의
 * `pg_stat_activity` 에서 `wait_event_type = 'Lock'` 으로 세면, 병렬로 도는 다른 실DB 파일이 같은 표·
 * advisory 잠금을 기다리는 것까지 센다 — 아직 줄 서지 않은 경쟁자를 줄 섰다고 보고 잠금을 일찍 놓아
 * 다른 순서로 경합이 풀린다(2026-10-23, complete-response-contact-race 가 전체 스위트에서만 깨지던 원인).
 *
 * 그래서 잠금을 쥔 트랜잭션의 백엔드 pid 를 받아, 그 pid 가 막고 있는 요청과 — 행 잠금은 두 번째
 * 대기자가 첫 대기자 뒤에 줄을 서므로 — 그 대기자들이 다시 막고 있는 요청까지 사슬로 센다(`pg_blocking_pids`).
 */

type Executor = { execute: (query: SQL) => Promise<unknown> };

/** 지금 트랜잭션(연결)의 백엔드 pid — 잠금을 쥐는 트랜잭션 안에서 부른다. */
export async function backendPid(executor: Executor): Promise<number> {
  const rows = (await executor.execute(sql`SELECT pg_backend_pid() AS pid`)) as Array<{
    pid: number;
  }>;
  const pid = rows[0]?.pid;
  if (typeof pid !== 'number') throw new Error('pg_backend_pid 를 읽지 못했습니다');
  return pid;
}

/** `holderPid` 가 쥔 잠금 뒤에 직접·사슬로 줄 선 요청 수. */
export async function countLockWaitersBehind(holderPid: number): Promise<number> {
  const rows = await db.execute<{ waiting: number }>(sql`
    WITH RECURSIVE behind(pid) AS (
      SELECT a.pid FROM pg_stat_activity a WHERE ${holderPid}::int = ANY(pg_blocking_pids(a.pid))
      UNION
      SELECT a.pid FROM pg_stat_activity a JOIN behind b ON b.pid = ANY(pg_blocking_pids(a.pid))
    )
    SELECT count(*)::int AS waiting FROM behind WHERE pid <> ${holderPid}::int
  `);
  return rows[0]?.waiting ?? 0;
}

/** `holderPid` 뒤에 `minimum` 개 이상이 줄 설 때까지 기다린다. 못 보면 `message` 로 던진다. */
export async function waitForLockWaitersBehind(
  holderPid: number,
  minimum: number,
  message: string,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await countLockWaitersBehind(holderPid)) >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
}
