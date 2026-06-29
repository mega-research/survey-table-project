#!/usr/bin/env bash
# 로컬 supabase test DB 셋업 (검증 절차 2026-06-05)
# supabase CLI 마이그레이션은 config.toml에서 비활성(prefix 중복 PK 충돌 회피).
# drizzle journal이 sql 파일과 미동기화라 db:migrate 대신 drizzle-kit push로 schema SoT를 직접 반영.
set -euo pipefail

LOCAL_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

redact_supabase_local_secrets() {
  sed -E \
    -e 's/sb_publishable_[A-Za-z0-9_-]+/sb_publishable_[redacted]/g' \
    -e 's/sb_secret_[A-Za-z0-9_-]+/sb_secret_[redacted]/g' \
    -e 's/(^|[^[:xdigit:]])[[:xdigit:]]{32,}([^[:xdigit:]]|$)/\1[redacted]\2/g'
}

echo "[1/4] supabase 로컬 스택 기동"
START_LOG="$(mktemp)"
if ! supabase start >"$START_LOG" 2>&1; then
  echo "ERROR: supabase 로컬 스택 기동 실패. 마스킹된 로그:" >&2
  redact_supabase_local_secrets <"$START_LOG" >&2
  rm -f "$START_LOG"
  exit 1
fi
rm -f "$START_LOG"

echo "[2/4] 빈 public 스키마로 reset"
supabase db reset

echo "[3/4] drizzle-kit push로 schema SoT 반영 (strict 일시 우회)"
# drizzle.config.ts의 strict:true는 TTY confirm을 요구하므로, 원본을 백업 후 strict:false로 토글하고 push, 복원한다.
cp drizzle.config.ts /tmp/drizzle.config.ts.bak
trap 'cp /tmp/drizzle.config.ts.bak drizzle.config.ts; rm -f /tmp/drizzle.config.ts.bak' EXIT
sed 's/strict: true/strict: false/' /tmp/drizzle.config.ts.bak > drizzle.config.ts
DATABASE_URL="$LOCAL_DB_URL" pnpm exec drizzle-kit push

echo "[4/4] 검증: public 테이블 개수"
CONTAINER="$(docker ps --filter name=supabase_db --format '{{.Names}}' | head -1)"
COUNT="$(docker exec "$CONTAINER" psql -U postgres -d postgres -tAc \
  "select count(*) from information_schema.tables where table_schema='public';")"
echo "public 테이블: $COUNT"
if [ "$COUNT" -lt 19 ]; then
  echo "ERROR: 테이블이 19개 미만. 셋업 실패." >&2
  exit 1
fi
echo "test DB 셋업 완료."
