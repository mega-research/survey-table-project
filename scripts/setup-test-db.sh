#!/usr/bin/env bash
# 로컬 supabase test DB 셋업 (검증 절차 2026-06-05, 객체 적용 단계 추가 2026-08-19)
#
# supabase CLI 마이그레이션은 config.toml에서 비활성(prefix 중복 PK 충돌 회피).
# drizzle journal이 sql 파일과 미동기화라 db:migrate 대신 drizzle-kit push로 schema SoT를 직접 반영.
#
# [3/5] 이 필요한 이유 (2026-08-19):
#   push 는 src/db/schema/*.ts 에 선언된 테이블·컬럼만 만든다. 이 레포는 DB 함수,
#   partial unique index, RLS, GRANT 를 수동 SQL 마이그레이션에 두므로 push 만으로 만든
#   테스트 DB 에는 그것들이 통째로 없었다. 그 결과 realdb 테스트 6개 파일이 프로덕션과
#   다른 구조 위에서 42P10(ON CONFLICT 추론 실패)·"함수 없음"으로 실패했고, RLS 는
#   아무도 검증하지 않았다. 그래서 push 뒤에 "객체를 담은" 마이그레이션을 덧입힌다.
#
#   덧입히는 단계에서 개별 파일 실패는 정상이다 — push 가 이미 만든 테이블·컬럼과
#   충돌하는 문장이 있기 때문이다. 그래서 파일 단위 실패는 기록만 하고, 최종 상태는
#   [4/5] 의 assert 가 판정한다. assert 가 이 셋업의 유일한 합격 기준이다.
set -euo pipefail

LOCAL_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

redact_supabase_local_secrets() {
  sed -E \
    -e 's/sb_publishable_[A-Za-z0-9_-]+/sb_publishable_[redacted]/g' \
    -e 's/sb_secret_[A-Za-z0-9_-]+/sb_secret_[redacted]/g' \
    -e 's/(^|[^[:xdigit:]])[[:xdigit:]]{32,}([^[:xdigit:]]|$)/\1[redacted]\2/g'
}

echo "[1/5] supabase 로컬 스택 기동"
START_LOG="$(mktemp)"
if ! supabase start >"$START_LOG" 2>&1; then
  echo "ERROR: supabase 로컬 스택 기동 실패. 마스킹된 로그:" >&2
  redact_supabase_local_secrets <"$START_LOG" >&2
  rm -f "$START_LOG"
  exit 1
fi
rm -f "$START_LOG"

echo "[2/5] 빈 public 스키마로 reset"
supabase db reset

echo "[3/5] drizzle-kit push로 schema SoT 반영 (strict 일시 우회)"
# drizzle.config.ts의 strict:true는 TTY confirm을 요구하므로, 원본을 백업 후 strict:false로 토글하고 push, 복원한다.
cp drizzle.config.ts /tmp/drizzle.config.ts.bak
trap 'cp /tmp/drizzle.config.ts.bak drizzle.config.ts; rm -f /tmp/drizzle.config.ts.bak' EXIT
sed 's/strict: true/strict: false/' /tmp/drizzle.config.ts.bak > drizzle.config.ts
DATABASE_URL="$LOCAL_DB_URL" pnpm exec drizzle-kit push

CONTAINER="$(docker ps --filter name=supabase_db --format '{{.Names}}' | head -1)"
if [ -z "$CONTAINER" ]; then
  echo "ERROR: supabase_db 컨테이너를 찾지 못했습니다." >&2
  exit 1
fi

echo "[4/5] push가 표현하지 못하는 객체(함수·인덱스·RLS·GRANT) 적용"
APPLIED=0
SKIPPED=0
SKIP_LOG="$(mktemp)"
while IFS= read -r tag; do
  if docker exec -i "$CONTAINER" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
      -f - <"supabase/migrations/${tag}.sql" >/dev/null 2>>"$SKIP_LOG"; then
    APPLIED=$((APPLIED + 1))
  else
    SKIPPED=$((SKIPPED + 1))
    echo "  건너뜀: $tag" >>"$SKIP_LOG"
  fi
done < <(node scripts/migration-order.mjs --objects-only)
echo "  적용 $APPLIED / 건너뜀 $SKIPPED (건너뜀 사유는 push 선반영과의 충돌 — 아래 검증으로 판정)"

echo "[5/5] 검증: 프로덕션 전용 객체가 실제로 생성됐는지"
verify() {
  local label="$1" query="$2" expected="$3" actual
  actual="$(docker exec "$CONTAINER" psql -U postgres -d postgres -tAc "$query" | tr -d '[:space:]')"
  if [ "$actual" -lt "$expected" ]; then
    echo "ERROR: ${label} 검증 실패 — 기대 ${expected} 이상, 실제 ${actual}" >&2
    echo "  건너뛴 마이그레이션 로그:" >&2
    cat "$SKIP_LOG" >&2
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

rm -f "$SKIP_LOG"
echo "test DB 셋업 완료."
