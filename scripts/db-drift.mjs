// 실 DB(prod/staging)와 레포가 만들어내는 DB(로컬 테스트 DB)의 객체 목록을 대조한다.
//
// 왜 필요한가: migration-journal-gate 는 "디렉터리에 있는 .sql 이 등재됐는가"만 본다.
// 파일로 쓰지 않고 SQL 에디터나 MCP 로 실 DB 에 직접 적용한 것은 검사 대상 자체가 없다.
// 실제로 lookup_contact_by_invite_token 함수와 surveys.user_id 컬럼이 그렇게 들어와,
// 레포만으로는 프로덕션을 재구성할 수 없는 상태가 몇 달간 방치됐다(2026-08-19 발견).
// 이 스크립트는 반대 방향 검사다 — 실 DB 에 있는데 레포에 없는 것을 찾는다.
//
// 사용: pnpm db:drift [prod|staging]   (기본 prod)
// 허용 목록의 기준선은 prod 다. staging 은 백업 복원 과정에서 ACL 이 초기화되는 등
// 고유 격차가 있어 별도로 보고되며, 그것들은 허용이 아니라 수리 대상이다.
// 전제: 로컬 테스트 DB 가 최신 상태여야 한다. 먼저 pnpm db:setup-test 를 돌릴 것.
//
// 모든 조회는 READ ONLY 트랜잭션에서 수행한다. 실 DB 를 건드리지 않는다.
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const ALLOWLIST_PATH = 'supabase/drift-allowlist.json';

const target = process.argv[2] ?? 'prod';
if (!['prod', 'staging'].includes(target)) {
  console.error('사용법: pnpm db:drift [prod|staging]');
  process.exit(2);
}

function liveUrl() {
  const file = target === 'prod' ? '.env.production' : '.env.local';
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error(`${file} 에 DATABASE_URL 이 없습니다.`);
  return line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
}

/** 한 DB 의 객체 목록을 수집한다. 전부 읽기 전용. */
async function inventory(url) {
  const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 5, connect_timeout: 10 });
  try {
    return await sql.begin(async (tx) => {
      await tx`SET TRANSACTION READ ONLY`;
      const tables = (await tx`
        SELECT tablename FROM pg_tables WHERE schemaname='public'`).map((r) => r.tablename);
      const columns = (await tx`
        SELECT table_name||'.'||column_name AS c FROM information_schema.columns
        WHERE table_schema='public'`).map((r) => r.c);
      // 사용자 정의 enum — 컬럼이 이 타입 위에 서 있으면 타입이 없는 DB 는 재구성 자체가 불가능하다
      const enums = (await tx`
        SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
        WHERE n.nspname='public' AND t.typtype='e'`).map((r) => r.typname);
      const functions = (await tx`
        SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS f
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public'`).map((r) => r.f);
      const indexes = await tx`
        SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public'`;
      // FK 제약 — 2026-08-19 추가. contact_attempts.campaign_id 가 프로덕션에서만 FK 를
      // 달고 있었는데 이 검사가 없어 놓쳤다. 우연히 레거시 정리로 함께 해소됐을 뿐이다.
      // 이름이 아니라 "출처테이블.컬럼 → 대상테이블" 로 비교한다 — 제약 이름은 생성 경로에
      // 따라 달라져도 관계 자체는 같아야 하기 때문이다.
      const foreignKeys = (await tx`
        SELECT src.relname||'.'||a.attname||' -> '||tgt.relname AS fk
        FROM pg_constraint c
        JOIN pg_class src ON src.oid = c.conrelid
        JOIN pg_class tgt ON tgt.oid = c.confrelid
        JOIN pg_namespace n ON n.oid = src.relnamespace
        JOIN unnest(c.conkey) AS k(attnum) ON true
        JOIN pg_attribute a ON a.attrelid = src.oid AND a.attnum = k.attnum
        WHERE c.contype = 'f' AND n.nspname = 'public'`).map((r) => r.fk);
      const rls = (await tx`
        SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity`).map((r) => r.tablename);
      const policies = (await tx`
        SELECT tablename||'.'||policyname AS p FROM pg_policies WHERE schemaname='public'`).map((r) => r.p);
      // anon/authenticated 에 권한이 열린 테이블·함수 — 보안 표면
      const tableGrants = (await tx`
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r'
          AND array_to_string(c.relacl,' ') ~ '(anon|authenticated)='`).map((r) => r.relname);
      const functionGrants = (await tx`
        SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public'
          AND array_to_string(p.proacl,' ') ~ '(anon|authenticated)='`).map((r) => r.proname);

      return {
        tables,
        columns,
        enums,
        functions,
        indexDefs: new Map(indexes.map((r) => [r.indexname, r.indexdef])),
        foreignKeys,
        rls,
        policies,
        tableGrants,
        functionGrants,
      };
    });
  } finally {
    await sql.end();
  }
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const isUnique = (def) => /CREATE UNIQUE INDEX/i.test(def);

let allow = {};
try {
  allow = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
} catch {
  console.log(`(허용 목록 ${ALLOWLIST_PATH} 없음 — 전부 신규 차이로 보고합니다)\n`);
}
const allowed = (kind, item) => Boolean(allow[kind]?.[item]);

console.log(`대조: ${target} ↔ 로컬 테스트 DB\n`);
const [live, repo] = await Promise.all([inventory(liveUrl()), inventory(LOCAL_URL)]);

const findings = [];   // 조치가 필요한 차이
const known = [];      // 허용 목록에 사유가 적힌 차이

function compare(kind, label, liveItems, repoItems, { direction = 'both' } = {}) {
  const liveOnly = liveItems.filter((x) => !repoItems.includes(x));
  const repoOnly = repoItems.filter((x) => !liveItems.includes(x));
  for (const x of liveOnly) {
    const entry = { kind, label, item: x, side: `${target}에만 있음`, note: allow[kind]?.[x] };
    (entry.note ? known : findings).push(entry);
  }
  if (direction === 'both') {
    for (const x of repoOnly) {
      const entry = { kind, label, item: x, side: '레포에만 있음', note: allow[kind]?.[x] };
      (entry.note ? known : findings).push(entry);
    }
  }
}

compare('tables', '테이블', live.tables, repo.tables);
// 허용된 테이블의 컬럼·인덱스는 함께 허용한다 (테이블 통째로 미관리라는 뜻)
const allowedTables = new Set(Object.keys(allow.tables ?? {}));
const keepCol = (c) => !allowedTables.has(c.split('.')[0]);
compare('columns', '컬럼', live.columns.filter(keepCol), repo.columns.filter(keepCol));
compare('enums', 'enum 타입', live.enums, repo.enums);
compare('functions', '함수', live.functions, repo.functions);
// 허용된 테이블에 딸린 RLS·권한·정책도 함께 허용한다 (테이블 통째로 미관리라는 뜻)
const keepTable = (t) => !allowedTables.has(t);
const keepPolicy = (p) => !allowedTables.has(p.split('.')[0]);
compare('foreignKeys', 'FK 제약',
  live.foreignKeys.filter((f) => keepTable(f.split('.')[0]) && keepTable(f.split(' -> ')[1])),
  repo.foreignKeys.filter((f) => keepTable(f.split('.')[0]) && keepTable(f.split(' -> ')[1])));
compare('policies', 'RLS 정책', live.policies.filter(keepPolicy), repo.policies.filter(keepPolicy));
compare('rls', 'RLS 활성', live.rls.filter(keepTable), repo.rls.filter(keepTable));
compare('tableGrants', 'anon/authenticated 테이블 권한',
  live.tableGrants.filter(keepTable), repo.tableGrants.filter(keepTable));
compare('functionGrants', 'anon/authenticated 함수 권한', live.functionGrants, repo.functionGrants);

// 인덱스: UNIQUE 는 동작을 바꾸므로 항상 보고한다. 비-UNIQUE 성능 인덱스는
// 테스트 DB 에 반영하지 않기로 한 결정(2026-08-19)이라 참고로만 센다.
const liveIdx = [...live.indexDefs.keys()];
const repoIdx = [...repo.indexDefs.keys()];
const perfOnly = [];
for (const name of liveIdx) {
  if (repoIdx.includes(name)) continue;
  const def = live.indexDefs.get(name);
  if (allowedTables.has(def.match(/ON public\.(\w+)/)?.[1])) continue;
  if (!isUnique(def)) { perfOnly.push(name); continue; }
  const entry = { kind: 'indexes', label: 'UNIQUE 인덱스', item: name, side: `${target}에만 있음`, note: allow.indexes?.[name] };
  (entry.note ? known : findings).push(entry);
}
for (const name of repoIdx) {
  if (liveIdx.includes(name)) continue;
  const entry = { kind: 'indexes', label: '인덱스', item: name, side: '레포에만 있음', note: allow.indexes?.[name] };
  (entry.note ? known : findings).push(entry);
}
// 이름이 같은데 정의가 다른 경우 — 오늘 문제가 된 술어 모순이 이 부류다
for (const name of liveIdx) {
  if (!repoIdx.includes(name)) continue;
  const a = norm(live.indexDefs.get(name));
  const b = norm(repo.indexDefs.get(name));
  if (a !== b) {
    findings.push({
      kind: 'indexes', label: '인덱스 정의 불일치', item: name, side: '양쪽 정의 상이',
      detail: `  ${target}: ${a}\n  repo : ${b}`,
    });
  }
}

// ── 출력 ──
if (known.length) {
  console.log(`알려진 차이 ${known.length}건 (허용 목록에 사유 기재됨)`);
  for (const f of known) console.log(`  · ${f.label} ${f.item} — ${f.note}`);
  console.log();
}
if (perfOnly.length) {
  console.log(`참고: ${target} 에만 있는 성능 인덱스 ${perfOnly.length}건 — 동작 무관, 동기화하지 않기로 결정됨`);
  console.log(`  ${perfOnly.join(', ')}\n`);
}

if (!findings.length) {
  console.log('신규 드리프트 없음.');
  process.exit(0);
}

console.log(`신규 드리프트 ${findings.length}건 — 조치 필요\n`);
for (const f of findings) {
  console.log(`  [${f.side}] ${f.label}: ${f.item}`);
  if (f.detail) console.log(f.detail);
}
console.log(`\n"${target}에만 있음" 은 레포에 정의가 없다는 뜻이다 — 마이그레이션으로 복구할 것.`);
console.log(`"레포에만 있음" 은 아직 적용하지 않은 마이그레이션이다 — 배포 전이면 정상.`);
console.log(`의도된 차이라면 ${ALLOWLIST_PATH} 에 사유와 함께 등재할 것.`);
process.exit(1);
