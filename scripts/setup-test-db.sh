#!/usr/bin/env bash
# 로컬 supabase test DB 셋업.
#
# 2026-08-19 개편: drizzle-kit push 를 걷어내고 실제 마이그레이션을 전량 재생한다.
#
# 이전에는 push 로 스키마만 반영했다. 이력이 빈 DB 에서 재생되지 않았기 때문인데, push 시대에
# 파일 없이 프로덕션에 들어온 컬럼·함수가 뒤쪽 마이그레이션의 전제를 무너뜨리고 있었다. 그래서
# 테스트 DB 에는 DB 함수·partial unique index·RLS 가 통째로 빠져, realdb 테스트가 프로덕션과
# 다른 구조 위에서 돌았다(2026-08-19 발견, 통합 테스트 6파일 23건 실패).
#
# 0004·0009·0019·0035·0037·0039 수선과 0079 복구로 재생이 가능해졌다. 이제 테스트 DB 는
# 프로덕션과 같은 경로로 만들어진다 — pnpm db:drift 로 프로덕션 대비 드리프트 0건을 확인했다.
#
# supabase CLI 마이그레이션은 config.toml 에서 비활성(파일명 prefix 중복 0003/0009/0019 이
# schema_migrations PK 와 충돌). 재생 순서는 scripts/migration-order.mjs 가 journal
# (_journal.json idx 순) → manual(manual-migrations.json 등재 순)으로 결정한다.
set -euo pipefail

redact_supabase_local_secrets() {
  sed -E \
    -e 's/sb_publishable_[A-Za-z0-9_-]+/sb_publishable_[redacted]/g' \
    -e 's/sb_secret_[A-Za-z0-9_-]+/sb_secret_[redacted]/g' \
    -e 's/(^|[^[:xdigit:]])[[:xdigit:]]{32,}([^[:xdigit:]]|$)/\1[redacted]\2/g'
}

# 테스트에 필요한 컨테이너는 db, auth(gotrue), kong 셋뿐이다.
#   - db   : 마이그레이션 재생과 realdb 테스트 대상
#   - auth : 앱의 supabase 사용처가 auth API 뿐이다 (제외 목록에 없어 항상 뜬다)
#   - kong : NEXT_PUBLIC_SUPABASE_URL 이 가리키는 :54321 게이트웨이. 인증 호출이 여기로 간다
# rest(PostgREST)는 앱이 쓰지 않지만 anon 권한을 로컬에서 눈으로 확인할 때 필요해 남긴다.
# 2026-08-19 실측: 전체 11개 컨테이너 1707MB → 제외 시 4개 593MB. CI 는 매 실행 이미지를
# 새로 받으므로 이 차이가 그대로 시간이 된다.
SUPABASE_EXCLUDE="studio,imgproxy,inbucket,edge-runtime,functions,realtime,storage,analytics,vector,meta"

echo "[1/4] supabase 로컬 스택 기동 (제외: $SUPABASE_EXCLUDE)"
START_AT=$(date +%s)
START_LOG="$(mktemp)"
if ! supabase start -x "$SUPABASE_EXCLUDE" >"$START_LOG" 2>&1; then
  echo "ERROR: supabase 로컬 스택 기동 실패. 마스킹된 로그:" >&2
  redact_supabase_local_secrets <"$START_LOG" >&2
  rm -f "$START_LOG"
  exit 1
fi
rm -f "$START_LOG"
echo "  기동 $(( $(date +%s) - START_AT ))초"

echo "[2/4] 빈 public 스키마로 reset"
supabase db reset

CONTAINER="$(docker ps --filter name=supabase_db --format '{{.Names}}' | head -1)"
if [ -z "$CONTAINER" ]; then
  echo "ERROR: supabase_db 컨테이너를 찾지 못했습니다." >&2
  exit 1
fi

echo "[3/4] 마이그레이션 전량 재생"
TOTAL="$(node scripts/migration-order.mjs | wc -l | tr -d ' ')"
APPLIED=0
while IFS= read -r tag; do
  APPLIED=$((APPLIED + 1))
  if ! docker exec -i "$CONTAINER" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
      -f - <"supabase/migrations/${tag}.sql" >/dev/null; then
    echo "ERROR: 마이그레이션 적용 실패 — ${tag}.sql" >&2
    echo "  빈 DB 재생이 깨졌다. 새 마이그레이션이 기존 상태를 전제하고 있지 않은지 확인할 것." >&2
    exit 1
  fi
done < <(node scripts/migration-order.mjs)
echo "  ${APPLIED}/${TOTAL} 적용 완료"

echo "[4/4] 검증: 프로덕션 고유 객체가 실제로 생성됐는지"
# 재생이 조용히 반쪽만 되는 것을 막는 최소 확인. 더 촘촘한 대조는 pnpm db:drift 소관이다.
verify() {
  local label="$1" query="$2" expected="$3" actual
  actual="$(docker exec "$CONTAINER" psql -U postgres -d postgres -tAc "$query" | tr -d '[:space:]')"
  if [ "$actual" -lt "$expected" ]; then
    echo "ERROR: ${label} 검증 실패 — 기대 ${expected} 이상, 실제 ${actual}" >&2
    exit 1
  fi
  echo "  ${label}: ${actual}"
}

verify "public 테이블" \
  "select count(*) from information_schema.tables where table_schema='public';" 19
# 앱이 SQL 로 직접 호출하는 DB 함수. 신규 함수를 추가하면 이 목록에도 넣을 것 —
# 여기 빠지면 "테스트는 통과하는데 프로덕션 경로만 깨지는" 상태를 다시 만든다.
verify "앱이 호출하는 DB 함수" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in
   ('next_campaign_run_number','next_single_send_run_number','next_contact_resid','lookup_contact_by_invite_token');" 4
verify "r2_deletion_candidates partial unique" \
  "select count(*) from pg_indexes where tablename='r2_deletion_candidates'
   and indexname='r2_deletion_candidates_pending_key_uq';" 1
verify "RLS 활성 테이블" \
  "select count(*) from pg_tables where schemaname='public' and rowsecurity;" 15

# 이 DB 가 "어느 레포 상태로" 만들어졌는지 남긴다.
#
# 로컬 supabase 도커는 워크트리 전체가 공유하는 단일 인스턴스다. 다른 브랜치가
# db:setup-test 를 돌리면 이 DB 는 그쪽 마이그레이션 집합으로 통째 교체되는데,
# pnpm db:drift 는 그걸 알 방법이 없어 남의 DB 를 내 레포와 대조하고 조용히
# 틀린 결과를 낸다 (2026-08-31 실제 발생). 그래서 지문을 찍어두고 db-drift.mjs
# 가 대조한다.
#
# public 이 아니라 _repo_meta 스키마에 둔다 — db:drift 는 public 만 훑으므로
# 이 표가 드리프트 항목으로 잡히지 않는다.
STAMP="$(node scripts/migration-order.mjs --hash)"
docker exec -i "$CONTAINER" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 <<SQL >/dev/null
CREATE SCHEMA IF NOT EXISTS _repo_meta;
CREATE TABLE IF NOT EXISTS _repo_meta.migration_stamp (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  order_hash text NOT NULL,
  tag_count integer NOT NULL,
  stamped_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO _repo_meta.migration_stamp (singleton, order_hash, tag_count)
VALUES (true, '${STAMP}', ${TOTAL})
ON CONFLICT (singleton) DO UPDATE
  SET order_hash = EXCLUDED.order_hash,
      tag_count = EXCLUDED.tag_count,
      stamped_at = now();
SQL
echo "  재생 지문: ${STAMP} (${TOTAL}건)"

echo "test DB 셋업 완료."
