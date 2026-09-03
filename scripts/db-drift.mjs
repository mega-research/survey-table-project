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
import { execFileSync } from 'node:child_process';
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

/**
 * 로컬 테스트 DB 가 이 레포의 마이그레이션 집합으로 만들어졌는지 확인한다 (fail-fast).
 *
 * 로컬 supabase 도커는 워크트리 전체가 공유하는 단일 인스턴스다. 다른 브랜치가
 * db:setup-test 를 돌리면 이 DB 는 그쪽 집합으로 통째 교체되는데, 그 상태로 대조하면
 * 남의 브랜치가 넣은 객체는 "레포에만 있음", 내 브랜치 신규 객체는 아예 누락으로 나온다.
 * 결과가 틀린 줄 모른 채 읽게 되므로 (2026-08-31 실제 발생) 여기서 멈춘다.
 *
 * setup-test-db.sh 가 찍는 지문은 재생 태그 목록과 순서를 모두 반영한다.
 */
async function assertLocalDbMatchesRepo() {
  const expected = execFileSync('node', ['scripts/migration-order.mjs', '--hash'], {
    encoding: 'utf8',
  }).trim();

  const sql = postgres(LOCAL_URL, { prepare: false, max: 1, idle_timeout: 5, connect_timeout: 10 });
  let stamp;
  try {
    const rows = await sql.begin(async (tx) => {
      await tx`SET TRANSACTION READ ONLY`;
      return tx`
        SELECT order_hash, tag_count, stamped_at
        FROM _repo_meta.migration_stamp
        LIMIT 1`;
    });
    stamp = rows[0];
  } catch {
    stamp = undefined; // 스키마·표가 없으면 지문 이전에 만들어진 DB
  } finally {
    await sql.end({ timeout: 5 });
  }

  if (!stamp) {
    console.error('ERROR: 로컬 테스트 DB 에 재생 지문이 없습니다.');
    console.error('  이 DB 가 어느 브랜치의 마이그레이션으로 만들어졌는지 알 수 없어 대조할 수 없습니다.');
    console.error('  pnpm db:setup-test 를 먼저 실행하십시오.');
    process.exit(2);
  }
  if (stamp.order_hash !== expected) {
    console.error('ERROR: 로컬 테스트 DB 가 이 레포 상태로 만들어지지 않았습니다.');
    console.error(`  DB 지문   : ${stamp.order_hash} (${stamp.tag_count}건, ${stamp.stamped_at.toISOString()})`);
    console.error(`  레포 지문 : ${expected}`);
    console.error('  로컬 supabase 도커는 워크트리 공용이라 다른 브랜치가 재생하면 통째로 바뀝니다.');
    console.error('  pnpm db:setup-test 를 다시 실행한 뒤 대조하십시오.');
    process.exit(2);
  }
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
      // 달고 있었는데 이 검사가 없어 놓쳤다.
      //
      // 지문은 pg_get_constraintdef 전문을 쓴다. 처음에는 "출처테이블.컬럼 -> 대상테이블"
      // 만 모았는데, 그러면 대상 컬럼·복합키 순서·ON DELETE/UPDATE·deferrable 이 전부
      // 빠져 동작이 달라져도 통과했다. 실측 확인 — response_answers 의 FK 를 CASCADE 에서
      // NO ACTION 으로 바꿔도 "드리프트 없음" 이었다. 이 레포는 FK 24개 중 CASCADE 16개,
      // SET NULL 6개로 삭제 동작에 실제로 의존하므로 놓치면 안 되는 축이다.
      // 제약 이름은 생성 경로에 따라 달라지므로 지문에서 제외한다.
      const foreignKeys = (await tx`
        SELECT src.relname||': '||pg_get_constraintdef(c.oid) AS fk
        FROM pg_constraint c
        JOIN pg_class src ON src.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = src.relnamespace
        WHERE c.contype = 'f' AND n.nspname = 'public'`).map((r) => r.fk.replace(/\s+/g, ' '));
      const rls = (await tx`
        SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity`).map((r) => r.tablename);
      const policies = (await tx`
        SELECT tablename||'.'||policyname AS p FROM pg_policies WHERE schemaname='public'`).map((r) => r.p);
      // anon/authenticated 가 실제로 접근 가능한 테이블·함수 — 보안 표면.
      //
      // ACL 문자열에서 'anon=' 를 찾던 이전 방식은 PUBLIC 상속을 통째로 놓쳤다. 새로 만든
      // 함수는 proacl 이 NULL(기본권한)이라 문자열 매칭에 안 걸리는데, PostgreSQL 기본값이
      // PUBLIC EXECUTE 라 anon 은 실행할 수 있다. 실측으로 확인한 뒤 has_*_privilege 로
      // 바꿨다 — 이쪽은 PUBLIC 상속과 롤 상속까지 반영한 실효 권한을 준다.
      const roles = (await tx`
        SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')`).map((r) => r.rolname);
      const tableGrants = roles.length === 0 ? [] : (await tx`
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r'
          AND EXISTS (
            SELECT 1 FROM unnest(${roles}::text[]) AS r(role)
            WHERE has_table_privilege(r.role, c.oid, 'SELECT,INSERT,UPDATE,DELETE')
          )`).map((r) => r.relname);
      const functionGrants = roles.length === 0 ? [] : (await tx`
        SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS fn
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.prokind IN ('f','p')
          AND EXISTS (
            SELECT 1 FROM unnest(${roles}::text[]) AS r(role)
            WHERE has_function_privilege(r.role, p.oid, 'EXECUTE')
          )`).map((r) => r.fn);
      // 이벤트 트리거 — 0082/0083 의 EXECUTE 자동 회수 같은 "예방 장치". 함수 실효 권한
      // 검사는 트리거가 사라진 뒤 새로 생긴 함수만 잡을 수 있어(한 박자 늦은 탐지),
      // 장치 자체의 존재·활성 상태·이벤트·태그·연결 함수를 지문으로 대조한다 (2026-08-19).
      // public 스키마 함수에 연결된 트리거만 — supabase 내장 트리거(extensions 등 타 스키마)는
      // 호스팅/CLI 스택 버전 차이로 노이즈가 되므로 범위 밖.
      // 연결 함수의 본문 해시·SECURITY DEFINER·search_path·소유자까지 지문에 넣는다 —
      // 메타데이터만 비교하면 본문이 다른(예: 0082 의 ON FUNCTION vs 0083 의 ON ROUTINE)
      // 트리거나 권한 회수를 생략하도록 변조된 본문을 구별하지 못한다.
      const eventTriggers = (await tx`
        SELECT t.evtname, t.evtenabled, t.evtevent, t.evttags, p.proname,
               md5(regexp_replace(pg_get_functiondef(p.oid), '\\s+', ' ', 'g')) AS defhash,
               p.prosecdef, p.proconfig,
               pg_get_userbyid(p.proowner) AS owner
        FROM pg_event_trigger t
        JOIN pg_proc p ON p.oid = t.evtfoid
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
        ORDER BY t.evtname`).map((r) => {
        const tags = r.evttags ? ` TAG(${[...r.evttags].sort().join(',')})` : '';
        const secdef = r.prosecdef ? ' SECDEF' : '';
        const config = r.proconfig ? ` CFG(${[...r.proconfig].sort().join(';')})` : '';
        return `${r.evtname} [${r.evtenabled}] ON ${r.evtevent}${tags} -> ${r.proname}` +
          `${secdef}${config} owner=${r.owner} def=${r.defhash}`;
      });

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
        eventTriggers,
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

await assertLocalDbMatchesRepo();

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
// 지문 형식: "출처테이블: FOREIGN KEY (...) REFERENCES 대상(...) ON DELETE ..."
const fkTables = (f) => [f.split(':')[0], (f.match(/REFERENCES ([\w"]+)/)?.[1] ?? '').replace(/"/g, '')];
const keepFk = (f) => fkTables(f).every(keepTable);
compare('foreignKeys', 'FK 제약',
  live.foreignKeys.filter(keepFk), repo.foreignKeys.filter(keepFk));
compare('policies', 'RLS 정책', live.policies.filter(keepPolicy), repo.policies.filter(keepPolicy));
compare('rls', 'RLS 활성', live.rls.filter(keepTable), repo.rls.filter(keepTable));
compare('tableGrants', 'anon/authenticated 테이블 권한',
  live.tableGrants.filter(keepTable), repo.tableGrants.filter(keepTable));
compare('functionGrants', 'anon/authenticated 함수 권한', live.functionGrants, repo.functionGrants);
// 활성 상태([O/D/R/A])까지 지문에 들어가므로 DISABLE 도 양쪽 상이로 드러난다
compare('eventTriggers', '이벤트 트리거', live.eventTriggers, repo.eventTriggers);

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
