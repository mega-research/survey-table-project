// 로컬 테스트 DB 가 **이 브랜치의 스키마인가** — realdb 실행 전 fail-fast 가드.
//
// 로컬 Supabase 하나를 여러 워크트리가 공유한다. `db:setup-test` 는 전체를 드롭하고 **그
// 워크트리의 마이그레이션만** 재생하므로, 형제 워크트리가 한 번 돌리면 이쪽 테이블이 통째로
// 사라진다. 그 상태로 `test:integration` 을 돌리면 47파일이 한꺼번에 죽고, 실패 메시지는
// `relation "users" does not exist` 뿐이라 원인이 코드처럼 보인다.
//
// **마커를 DB 에 심지 않는다.** 심으면 `db:drift` 가 레포에 없는 객체로 잡아 영구 노이즈가
// 된다. 대신 마이그레이션 파일에서 기대 테이블 집합을 뽑아 실제와 대조한다 — 브랜치가 무엇이든
// 자기 파일을 보므로 이 스크립트는 브랜치를 모른다.
//
// 이 가드는 **막는 것이 일이 아니라 이름을 붙이는 것이 일이다.** 판정이 애매하면(파싱이
// 빈약하거나 DB 에 닿지 못하면) 통과시킨다 — 거짓 차단은 이 가드가 없는 것보다 나쁘다.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';

const DIR = 'supabase/migrations';
const LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const url = process.env['DATABASE_URL'] ?? LOCAL_URL;

// **로컬만 본다.** 원격을 향해 돌면 스테이징·프로덕션 스키마를 이 브랜치 기준으로 판정하게
// 되는데, 그 둘은 배포 전이라 뒤처져 있는 것이 정상이다(드리프트 점검은 db:drift 소관).
if (!/(?:127\.0\.0\.1|localhost)/.test(url)) {
  process.exit(0);
}

/** 마이그레이션 재생 순서 — 파일명이 아니라 manifest 배열이 정한다(migration-order 주석). */
function orderedTags() {
  return execFileSync('node', ['scripts/migration-order.mjs'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

/**
 * 재생이 끝났을 때 남아 있어야 할 테이블 — 생성에서 삭제를 뺀다.
 *
 * 순서대로 훑는 것이 요점이다: 0080 이 옛 메일 테이블을 지우므로, 집합 연산을 순서 없이 하면
 * 이미 사라진 테이블을 기대하게 된다.
 */
function expectedTables(tags) {
  const create = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;
  const drop = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;
  const tables = new Set();
  for (const tag of tags) {
    const sql = readFileSync(join(DIR, `${tag}.sql`), 'utf8');
    for (const m of sql.matchAll(create)) tables.add(m[1]);
    for (const m of sql.matchAll(drop)) tables.delete(m[1]);
  }
  return tables;
}

async function main() {
  let expected;
  try {
    expected = expectedTables(orderedTags());
  } catch {
    // 마이그레이션 목록을 못 읽었다 — 그 자체는 db:setup-test 가 훨씬 또렷하게 말해 준다.
    process.exit(0);
  }
  // 파싱이 빈약하면 판정하지 않는다. 정규식이 언젠가 어긋나도 거짓 차단은 만들지 않는다.
  if (expected.size < 20) process.exit(0);

  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 5 });
  let actual;
  try {
    const rows = await sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    `;
    actual = new Set(rows.map((r) => r.table_name));
  } catch {
    // DB 가 안 떠 있다 — 그것도 db:setup-test 가 말할 일이다.
    process.exit(0);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }

  const missing = [...expected].filter((t) => !actual.has(t)).sort();
  if (missing.length === 0) process.exit(0);

  console.error(
    [
      '',
      '로컬 테스트 DB 가 이 브랜치의 스키마가 아닙니다.',
      '',
      `  없는 테이블 ${missing.length}개: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' …' : ''}`,
      '',
      '  로컬 Supabase 하나를 여러 워크트리가 공유하고, db:setup-test 는 그 워크트리의',
      '  마이그레이션만 재생합니다. 다른 워크트리가 재생한 상태로 보입니다.',
      '',
      '  → pnpm db:setup-test 로 재생한 뒤 다시 실행하세요.',
      '    (그 재생은 형제 워크트리의 스키마를 덮어씁니다)',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

await main();
