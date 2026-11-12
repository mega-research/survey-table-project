import { execFileSync } from 'node:child_process';

import postgres from 'postgres';

/**
 * 실DB 테스트(RUN_REALDB=1) 시작 전 — 대상 DB 가 **이 브랜치의 마이그레이션으로** 만들어졌는지 본다.
 *
 * 로컬 supabase 는 워크트리 전체가 같이 쓰는 인스턴스 하나라, 공유 DB(postgres)는 마지막으로
 * `db:setup-test` 를 돌린 브랜치의 스키마다. 그 위에서 돌리면 없는 열에 INSERT 하다 수십 건이
 * 긴 SQL 덤프로 죽고 원인이 코드처럼 보인다(2026-11-11). `pnpm test:integration` 의 사전 확인
 * (check-test-db-schema)은 테이블 이름만 보고, `vitest run` 을 직접 부르면 그것마저 건너뛴다.
 *
 * 그래서 재생 지문(`_repo_meta.migration_stamp` — scripts/lib/test-db.sh 의 stamp_test_db)을
 * 대조하고, 다르면 테스트를 하나도 돌리지 않고 한 문단으로 멈춘다.
 *
 * 이 가드는 이름을 붙이는 것이 일이다 — DB 에 닿지 못하거나 원격이면 통과시킨다.
 */
export default async function realDbGlobalSetup(): Promise<void> {
  if (process.env['RUN_REALDB'] !== '1') return;
  const url = process.env['DATABASE_URL'] ?? '';
  if (!/(?:127\.0\.0\.1|localhost)/.test(url)) return;

  const expected = execFileSync('node', ['scripts/migration-order.mjs', '--hash'], {
    encoding: 'utf8',
  }).trim();

  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 5 });
  let actual: string | null;
  try {
    const rows = await sql<{ order_hash: string }[]>`
      select order_hash from _repo_meta.migration_stamp limit 1
    `;
    actual = rows[0]?.order_hash ?? null;
  } catch (error) {
    // 42P01(표 없음)·3F000(스키마 없음) = 지문 이전에 만들어졌거나 남이 만든 DB. 그 밖은 접속 실패 — 통과.
    const code = (error as { code?: string }).code;
    if (code !== '42P01' && code !== '3F000') return;
    actual = null;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }

  if (actual === expected) return;

  const dbName = new URL(url).pathname.replace(/^\//, '');
  // 던지지 않고 찍고 끝낸다 — 던지면 vitest 가 내부 스택 열 줄을 붙여 정작 할 일이 묻힌다.
  console.error(
    [
      '',
      `테스트 DB(${dbName})가 이 브랜치의 마이그레이션으로 만들어지지 않았습니다 — 테스트를 돌리지 않습니다.`,
      `  DB 지문 ${actual ?? '없음'} · 레포 지문 ${expected}`,
      '  내 브랜치 전용 DB 를 만들어 그 주소로 돌리세요:',
      '    pnpm db:isolated <이름>   →   RUN_REALDB=1 DATABASE_URL=<출력된 URL> pnpm exec vitest run <파일>',
      '  (공유 DB 를 이 브랜치로 다시 만드는 pnpm db:setup-test 는 형제 워크트리의 스키마를 덮어씁니다)',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
