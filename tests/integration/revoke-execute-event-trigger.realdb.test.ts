/**
 * 0082/0083 권한 회수 이벤트 트리거 실 DB integration test.
 * public 스키마에 함수·프로시저를 만들 때 (1) DDL 자체가 성공하고 (2) anon/authenticated
 * EXECUTE 가 생성 즉시 회수되는지 고정한다. 0082 는 CREATE PROCEDURE 에 REVOKE ... ON
 * FUNCTION 을 실행해 DDL 전체를 롤백시키는 결함이 있었다 (0083 에서 ON ROUTINE 으로 교정).
 * 실행 조건: DATABASE_URL 이 로컬(127.0.0.1/localhost)일 때만. prod URL 에서는 전체 skip.
 * 선행: pnpm db:setup-test (마이그레이션 전량 재생).
 */
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

const FN = '_evt_trigger_test_fn';
const PROC = '_evt_trigger_test_proc';

describe.skipIf(!isLocalDb)('신규 함수/프로시저 EXECUTE 자동 회수 (real local DB)', () => {
  afterAll(async () => {
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS public.${FN}(int)`));
    await db.execute(sql.raw(`DROP PROCEDURE IF EXISTS public.${PROC}(int)`));
  });

  it('이벤트 트리거가 존재하고 활성 상태다', async () => {
    const rows = await db.execute(sql`
      SELECT evtname, evtenabled FROM pg_event_trigger
      WHERE evtname = 'revoke_anon_execute_on_new_functions'`);
    expect(rows).toHaveLength(1);
    // 'O' = enabled (origin)
    expect((rows[0] as { evtenabled: string }).evtenabled).toBe('O');
  });

  it('CREATE FUNCTION 이 성공하고 anon/authenticated EXECUTE 가 즉시 회수된다', async () => {
    await db.execute(sql.raw(
      `CREATE FUNCTION public.${FN}(x int) RETURNS int LANGUAGE sql AS $$ SELECT x $$`,
    ));
    const rows = await db.execute(sql`
      SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = ${FN}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ anon_exec: false, auth_exec: false });
  });

  it('CREATE PROCEDURE 가 트리거에 막히지 않고 성공하며 EXECUTE 가 회수된다', async () => {
    // 0082 결함 재현 조건 — ON FUNCTION 이었다면 이 DDL 자체가 이벤트 트리거 에러로 롤백된다.
    await db.execute(sql.raw(
      `CREATE PROCEDURE public.${PROC}(x int) LANGUAGE sql AS $$ SELECT 1 $$`,
    ));
    const rows = await db.execute(sql`
      SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = ${PROC}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ anon_exec: false, auth_exec: false });
  });
});
