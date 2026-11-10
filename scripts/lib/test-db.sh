# 로컬 테스트 DB 공용 조각 — setup-test-db.sh 와 test-db-isolated.sh 가 source 한다.
#
# 레포 루트에서 source 할 것 (supabase/config.toml·scripts/migration-order.mjs 를 상대 경로로 읽는다).

# 이 레포의 supabase db 컨테이너 이름. config.toml 의 project_id 로 정한다.
#
# 예전에는 `docker ps --filter name=supabase_db | head -1` 이었다. 다른 supabase 프로젝트
# (supabase_db_photo-project 등)가 같은 기계에 떠 있으면 그쪽이 먼저 나올 수 있고, 그러면
# 마이그레이션이 남의 DB 에 재생된다.
test_db_container() {
  local project_id
  project_id="$(sed -nE 's/^project_id[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' supabase/config.toml | head -1)"
  if [ -z "$project_id" ]; then
    echo "ERROR: supabase/config.toml 에서 project_id 를 읽지 못했습니다." >&2
    return 1
  fi
  local name="supabase_db_${project_id}"
  if ! docker ps --format '{{.Names}}' | grep -qx "$name"; then
    echo "ERROR: ${name} 컨테이너가 떠 있지 않습니다. 'supabase start' 를 먼저 실행하세요." >&2
    return 1
  fi
  echo "$name"
}

# 마이그레이션을 manual-migrations.json 순서로 전량 재생한다.
#   $1 컨테이너  $2 DB 이름  $3 (선택) 1 이면 pg_cron CREATE EXTENSION 줄을 건너뛴다
# pg_cron 은 cron.database_name(=postgres) 에서만 만들 수 있어 postgres 가 아닌 DB 에서는
# 거부된다. 그 줄만 빼고 함수 정의와 나머지 DDL 은 그대로 재생한다.
replay_migrations() {
  local container="$1" db="$2" skip_cron="${3:-0}" total applied=0 tag
  total="$(node scripts/migration-order.mjs | wc -l | tr -d ' ')"
  while IFS= read -r tag; do
    applied=$((applied + 1))
    if [ "$skip_cron" = 1 ]; then
      sed 's/^CREATE EXTENSION IF NOT EXISTS pg_cron;/-- (isolated db) pg_cron skipped/' "supabase/migrations/${tag}.sql"
    else
      cat "supabase/migrations/${tag}.sql"
    fi | docker exec -i -e PGOPTIONS="-c client_min_messages=warning" "$container" psql -U postgres -d "$db" -q -v ON_ERROR_STOP=1 -f - >/dev/null || {
      echo "ERROR: 마이그레이션 적용 실패 (${applied}/${total}) — ${tag}.sql" >&2
      echo "  빈 DB 재생이 깨졌다. 새 마이그레이션이 기존 상태를 전제하고 있지 않은지 확인할 것." >&2
      return 1
    }
  done < <(node scripts/migration-order.mjs)
  echo "  ${applied}/${total} 적용 완료"
}

# 재생이 조용히 반쪽만 되는 것을 막는 최소 확인. 더 촘촘한 대조는 pnpm db:drift 소관이다.
#   $1 컨테이너  $2 DB 이름
verify_test_db() {
  local container="$1" db="$2"
  _verify() {
    local label="$1" query="$2" expected="$3" actual
    actual="$(docker exec "$container" psql -U postgres -d "$db" -tAc "$query" | tr -d '[:space:]')"
    if [ "$actual" -lt "$expected" ]; then
      echo "ERROR: ${label} 검증 실패 — 기대 ${expected} 이상, 실제 ${actual}" >&2
      return 1
    fi
    echo "  ${label}: ${actual}"
  }
  _verify "public 테이블" \
    "select count(*) from information_schema.tables where table_schema='public';" 19 || return 1
  # 앱이 SQL 로 직접 호출하는 DB 함수. 신규 함수를 추가하면 이 목록에도 넣을 것 —
  # 여기 빠지면 "테스트는 통과하는데 프로덕션 경로만 깨지는" 상태를 다시 만든다.
  _verify "앱이 호출하는 DB 함수" \
    "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in
     ('next_campaign_run_number','next_single_send_run_number','next_contact_resid','lookup_contact_by_invite_token');" 4 || return 1
  _verify "r2_deletion_candidates partial unique" \
    "select count(*) from pg_indexes where tablename='r2_deletion_candidates'
     and indexname='r2_deletion_candidates_pending_key_uq';" 1 || return 1
  _verify "RLS 활성 테이블" \
    "select count(*) from pg_tables where schemaname='public' and rowsecurity;" 15 || return 1
}

# 이 DB 가 "어느 레포 상태로" 만들어졌는지 남긴다.
#   $1 컨테이너  $2 DB 이름
#
# 로컬 supabase 도커는 워크트리 전체가 공유하는 단일 인스턴스다. 다른 브랜치가
# db:setup-test 를 돌리면 공유 DB 는 그쪽 마이그레이션 집합으로 통째 교체되는데,
# pnpm db:drift 는 그걸 알 방법이 없어 남의 DB 를 내 레포와 대조하고 조용히
# 틀린 결과를 낸다 (2026-08-31 실제 발생). 그래서 지문을 찍어두고 db-drift.mjs
# 가 대조한다. 격리 DB(db:isolated)에도 찍는다 — 만든 뒤 마이그레이션이 늘면 낡는다.
#
# public 이 아니라 _repo_meta 스키마에 둔다 — db:drift 는 public 만 훑으므로
# 이 표가 드리프트 항목으로 잡히지 않는다.
stamp_test_db() {
  local container="$1" db="$2" stamp total
  stamp="$(node scripts/migration-order.mjs --hash)"
  total="$(node scripts/migration-order.mjs | wc -l | tr -d ' ')"
  docker exec -i "$container" psql -U postgres -d "$db" -q -v ON_ERROR_STOP=1 <<SQL >/dev/null
CREATE SCHEMA IF NOT EXISTS _repo_meta;
CREATE TABLE IF NOT EXISTS _repo_meta.migration_stamp (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  order_hash text NOT NULL,
  tag_count integer NOT NULL,
  stamped_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO _repo_meta.migration_stamp (singleton, order_hash, tag_count)
VALUES (true, '${stamp}', ${total})
ON CONFLICT (singleton) DO UPDATE
  SET order_hash = EXCLUDED.order_hash,
      tag_count = EXCLUDED.tag_count,
      stamped_at = now();
SQL
  echo "  재생 지문: ${stamp} (${total}건)"
}
