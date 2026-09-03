// 로컬 테스트 DB 가 **이 브랜치의 스키마인가** — realdb 실행 전 fail-fast 가드.
//
// 로컬 Supabase 하나를 여러 워크트리가 공유한다. `db:setup-test` 는 전체를 드롭하고 **그
// 워크트리의 마이그레이션만** 재생하므로, 형제 워크트리가 한 번 돌리면 이쪽 테이블이 통째로
// 사라진다. 그 상태로 `test:integration` 을 돌리면 수십 파일이 한꺼번에 죽고, 실패 메시지는
// `relation "users" does not exist` 뿐이라 원인이 코드처럼 보인다.
//
// **마커를 DB 에 심지 않는다.** 심으면 `db:drift` 가 레포에 없는 객체로 잡아 영구 노이즈가
// 된다.
//
// **기대 목록의 출처는 drizzle 스키마다.** 처음엔 마이그레이션 SQL 을 정규식으로 훑었는데
// 그 판정이 두 번 틀렸다 — 90개 파일의 CREATE/DROP 을 세다 보니 `contact_targets` 와 메일
// 4종을 통째로 놓쳤고(파서가 18개만 봤다, 실제 26개), 남은 수가 임계값 아래로 떨어진
// 브랜치에서는 가드가 **한 번도 돌지 않은 채 늘 통과**했다. 통과와 기권이 둘 다 exit 0 이라
// 그 사실이 드러나지도 않았다. 스키마는 앱이 실제로 쓰는 정본이고 tsc 가 지키므로, 세는
// 대신 물어보는 편이 짧고 정확하다.
//
// 이 가드는 **막는 것이 일이 아니라 이름을 붙이는 것이 일이다.** DB 에 닿지 못하면
// 통과시킨다 — 거짓 차단은 이 가드가 없는 것보다 나쁘다.
import { getTableName, is, Table } from 'drizzle-orm';
import postgres from 'postgres';

import * as schema from '../src/db/schema';

const LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const url = process.env['DATABASE_URL'] ?? LOCAL_URL;

// **로컬만 본다.** 원격을 향해 돌면 스테이징·프로덕션을 이 브랜치 기준으로 판정하게 되는데,
// 그 둘은 배포 전이라 뒤처져 있는 것이 정상이다(드리프트 점검은 db:drift 소관).
if (!/(?:127\.0\.0\.1|localhost)/.test(url)) process.exit(0);

const expected = Object.values(schema)
  .filter((v): v is Table => is(v, Table))
  .map((t) => getTableName(t));

// 스키마를 못 읽었다면 판정할 자격이 없다. 정상 브랜치에서는 수십 개다.
if (expected.length < 5) process.exit(0);

// tsx 가 이 레포에서 CJS 로 트랜스파일하므로 top-level await 을 쓰지 않는다.
async function actualTables(): Promise<Set<string> | null> {
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 5 });
  try {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    `;
    return new Set(rows.map((r) => r.table_name));
  } catch {
    // DB 가 안 떠 있다 — 그것도 db:setup-test 가 훨씬 또렷하게 말해 준다.
    return null;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

async function main(): Promise<void> {
const actual = await actualTables();
if (actual === null) process.exit(0);

const missing = [...new Set(expected)].filter((t) => !actual.has(t)).sort();
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

void main();
