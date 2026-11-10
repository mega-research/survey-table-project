#!/usr/bin/env bash
# 내 브랜치 전용 테스트 DB — 공유 DB(postgres)를 건드리지 않는다.
#
# 로컬 supabase 도커는 워크트리 전체가 같이 쓰는 인스턴스 하나다. `pnpm db:setup-test` 는 그
# 공유 DB 를 통째로 다시 만들고 `pnpm test:integration` 은 그 DB 를 쓰므로, 형제 워크트리가
# 리셋하면 내 realdb 테스트가 남의 마이그레이션 위에서 돌거나 전멸한다. 이 스크립트는 같은
# 컨테이너에 이름 붙인 DB 를 따로 만들어 마이그레이션을 전량 재생한다 — 빈 DB 재생 검증도 겸한다.
#
# 사용:
#   pnpm db:isolated <이름>          # 만들기(있으면 지우고 다시). 마지막 줄에 DATABASE_URL
#   pnpm db:isolated <이름> --drop   # 지우기
#   RUN_REALDB=1 DATABASE_URL=<출력된 URL> pnpm exec vitest run <realdb 파일…>
#   pnpm db:drift staging --local-db <이름>   # 공유 DB 를 리셋하지 않고 실 DB 와 대조
#
# 이름은 소문자·숫자·밑줄(예: ceh_t01). postgres 는 공유 DB 라 받지 않는다.
#
# supabase 스택이 만들어 주는 것 중 레포 마이그레이션이 전제하는 셋만 흉내 낸다:
#   - auth.uid() / auth.users — RLS 정책 식과 FK 대상 (gotrue 소관)
#   - pg_cron — postgres DB 에서만 설치된다. CREATE EXTENSION 줄만 건너뛰고 나머지는 재생
# 그래서 이 DB 에서는 cron 잡이 실제로 돌지 않는다. cron 동작 자체를 보는 테스트는 공유 DB 에서.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/test-db.sh
source scripts/lib/test-db.sh

DB="${1:-}"
ACTION="${2:-create}"
if ! [[ "$DB" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || [ "$DB" = postgres ] || [[ "$DB" == template* ]]; then
  echo "사용: pnpm db:isolated <이름 — 소문자·숫자·밑줄, postgres 제외> [--drop]" >&2
  exit 2
fi

CONTAINER="$(test_db_container)"
psql_admin() { docker exec "$CONTAINER" psql -U postgres -q -v ON_ERROR_STOP=1 "$@"; }

psql_admin -c "DROP DATABASE IF EXISTS ${DB} WITH (FORCE);" >/dev/null
if [ "$ACTION" = --drop ]; then
  echo "${DB} 지움"
  exit 0
fi

echo "[1/3] ${DB} 생성 (컨테이너 ${CONTAINER})"
psql_admin -c "CREATE DATABASE ${DB};" >/dev/null
docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
CREATE SCHEMA IF NOT EXISTS cron;
CREATE OR REPLACE FUNCTION cron.schedule(text, text, text) RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;
CREATE OR REPLACE FUNCTION cron.unschedule(text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
SQL

echo "[2/3] 마이그레이션 전량 재생"
replay_migrations "$CONTAINER" "$DB" 1

echo "[3/3] 검증"
verify_test_db "$CONTAINER" "$DB"
stamp_test_db "$CONTAINER" "$DB"

echo "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/${DB}"
