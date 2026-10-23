// 실 DB(prod/staging/local)의 테이블별 크기와 인덱스 사용 횟수를 보여 준다.
//
// 왜 필요한가: 인덱스는 행을 지워도 파일 크기를 돌려주지 않는다. 한때 행이 많았다가 크게 줄면
// 그 최고점 크기가 남는다 — response_answers 는 7.4만 행에 인덱스 63MB 였다(2026-10-23, 0142 로 제거).
// 주기 작업으로 다시 만들 일은 아니고(평소 쓰기로는 최고점에서 멈춘다), 대량 작업 뒤·배포 전에
// 이 표를 보고 부풀었으면 손으로 `REINDEX TABLE CONCURRENTLY <표>` 를 돌린다. 트랜잭션 안에서
// 돌 수 없으므로 앱 풀러(6543)가 아니라 SQL 에디터나 세션 연결에서 실행할 것.
//
// 사용: pnpm db:size [prod|staging|local]   (기본 prod)
//
// 모든 조회는 READ ONLY 트랜잭션 안에서 한다. 풀러에 세션 SET 을 남기지 않는다.
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const target = process.argv[2] ?? 'prod';
if (!['prod', 'staging', 'local'].includes(target)) {
  console.error('사용법: pnpm db:size [prod|staging|local]');
  process.exit(2);
}

function databaseUrl() {
  if (target === 'local') return LOCAL_URL;
  const file = target === 'prod' ? '.env.production' : '.env.local';
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error(`${file} 에 DATABASE_URL 이 없습니다.`);
  return line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
}

const sql = postgres(databaseUrl(), { prepare: false, max: 1, idle_timeout: 5, connect_timeout: 10 });

try {
  await sql.begin('read only', async (tx) => {
    const [db] = await tx`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`;
    console.log(`DB ${target}: ${db.size}\n`);

    const tables = await tx`
      SELECT c.relname AS "표",
        s.n_live_tup AS "행",
        pg_size_pretty(pg_relation_size(c.oid)) AS "힙",
        pg_size_pretty(pg_indexes_size(c.oid)) AS "인덱스",
        pg_size_pretty(COALESCE(pg_total_relation_size(c.reltoastrelid), 0)) AS "TOAST",
        pg_size_pretty(pg_total_relation_size(c.oid)) AS "합계",
        CASE WHEN s.n_live_tup > 0
          THEN round(pg_indexes_size(c.oid)::numeric / s.n_live_tup)::int END AS "행당 인덱스 바이트"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY pg_total_relation_size(c.oid) DESC
      LIMIT 15`;
    console.table(tables);

    const indexes = await tx`
      SELECT t.relname AS "표", i.relname AS "인덱스",
        pg_size_pretty(pg_relation_size(i.oid)) AS "크기", st.idx_scan AS "사용 횟수"
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_class t ON t.oid = x.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      LEFT JOIN pg_stat_user_indexes st ON st.indexrelid = i.oid
      WHERE n.nspname = 'public' AND NOT x.indisunique
      ORDER BY pg_relation_size(i.oid) DESC
      LIMIT 20`;
    console.log('\n유일하지 않은 인덱스 (큰 순) — 사용 0회이고 크면 지울 후보');
    console.table(indexes);
  });
} finally {
  await sql.end();
}
