# 재해복구 런북 (Disaster Recovery)

> 단일 운영환경이다. `dev.megaresearch.co.kr` 은 이름과 달리 vercel-production 이고,
> Supabase 프로젝트도 하나뿐이다(`uyfahntiitrcuizdnlbq`, ap-northeast-2, compute Micro).
> 별도 staging/dev DB 가 없으므로 운영 DB 가 곧 유일한 진실의 원천이다.
> 관련: `memory/megaresearch-single-prod-env`, `memory/feedback_drizzle_migrate_journal`.

---

## 1. 마이그레이션 추적 — 두 시스템 혼용 (중요)

이 repo 의 DB 스키마는 **두 개의 분리된 추적 시스템**으로 적용돼 왔다. 어느 쪽도 단독으로
전체 스키마를 재현하지 못한다.

| 시스템 | 추적 파일 | 적용 명령 | 범위 |
|--------|-----------|-----------|------|
| drizzle | `supabase/migrations/meta/_journal.json` | `pnpm db:migrate` | 일부(20개) — drizzle generate 산출물 + 초기 수동 일부 |
| supabase | DB 의 `supabase_migrations.schema_migrations` | MCP `apply_migration` / 직접 SQL | RLS·GRANT·인덱스·함수 등 0020~0039 수동분 |

- `_journal.json` 은 `0000~0019` 의 부분집합(20 entry)만 가진다.
- `0001`, `0003_clever_dazzler`, `0009_add_hide_column_labels`, `0019_add_contact_unsubscribe`,
  그리고 `0020~0039` 는 **journal 밖**이며, MCP/직접 SQL 로 prod 에 적용됐다. 이 목록은
  `supabase/migrations/manual-migrations.json` 에 명시돼 있고 CI 게이트가 강제한다(§4).
- RLS 활성(0035/0036), PII GRANT REVOKE(0036/0037), dedup 인덱스(0038),
  함수 anon EXECUTE REVOKE(0039) 같은 **보안 하드닝이 전부 journal 밖**이다.

### 함의: `db:migrate` 로 복구하면 안 된다

신규/빈 DB 에 `pnpm db:migrate` 를 돌리면 **`0000~0019` 부분집합만** 적용되어
RLS-off + anon GRANT 노출 + 인덱스 누락 상태가 된다. 보안 하드닝이 통째로 빠진다.

---

## 2. 올바른 복구 경로

복구는 **마이그레이션 재생이 아니라 스냅샷 복원**으로 한다.

### 2-A. Supabase 플랫폼 백업/PITR 복원 (1순위)

1. Supabase 대시보드 → 프로젝트 → Database → Backups.
2. 최신 daily backup 또는 PITR 타임스탬프 선택 → Restore.
3. 복원 후 §3 검증 체크리스트 수행.

> ⚠️ **선행 확인 필요(미해결 액션)**: 이 프로젝트가 **daily backup / PITR 이 실제로
> 활성인지 대시보드에서 직접 확인**해야 한다. Supabase 관리 API(MCP)로는 백업/PITR
> 설정이 노출되지 않아 코드/도구로 검증 불가했다. Micro/무료 티어는 PITR 미포함이고
> daily backup 도 제한적일 수 있으므로, **런칭 전 Pro 티어 + PITR 활성화**를 검토하라.
> 이게 사실상 유일한 안전망이다.

### 2-B. 논리 덤프/복원 (대안·정기 백업)

플랫폼 백업이 없거나 부족하면 정기적으로 논리 덤프를 떠 둔다.

```bash
# 전체 스키마 + 데이터 덤프 (postgres 롤 = DATABASE_URL)
supabase db dump --db-url "$DATABASE_URL" -f backup_$(date +%Y%m%d).sql
# 또는
pg_dump "$DATABASE_URL" --no-owner --no-privileges -Fc -f backup.dump

# 복원
psql "$NEW_DB_URL" -f backup_YYYYMMDD.sql        # plain
pg_restore --no-owner -d "$NEW_DB_URL" backup.dump  # custom format
```

- `survey:backup`(`scripts/backup-survey.ts`)은 **단일 설문 1회성 덤프**라 운영 백업이
  아니다. contact_pii / mail_* / contact_attempts 등은 백업 범위 밖이다. DR 용도로 쓰지 말 것.

---

## 3. 복구 후 검증 체크리스트

복원 직후 보안 하드닝이 살아있는지 확인한다(journal 밖 적용분이라 누락되기 쉽다).

- [ ] RLS 활성: 주요 public 테이블에 `rowsecurity = true`
- [ ] PII 차단: `contact_targets`·`contact_pii` 에 `anon`/`authenticated` GRANT 0건, 정책 0건(deny-all)
- [ ] 함수 권한: `lookup_contact_by_invite_token` 의 anon/authenticated EXECUTE = false, postgres = true
- [ ] dedup 인덱스: `idx_resp_dedup_device`, `idx_resp_dedup_fp_ip` 존재
- [ ] 앱 부팅: `DATABASE_URL`(postgres 롤) 로 응답 수집/조회 정상
- [ ] env: `UPSTASH_*`, `ADMIN_USER_IDS`, `CONTACT_PII_KEY`, `CONTACT_PII_HMAC_KEY`,
      `DUPLICATE_DETECTION_SALT`, `RESEND_*`, `R2_*` 전부 설정
      (특히 `DUPLICATE_DETECTION_SALT`·`CONTACT_PII_HMAC_KEY` 는 회전 금지 — 회전 시
      기존 hash/blind index 전부 무효)

검증 SQL 예시는 `0036`/`0037`/`0039` 마이그레이션 파일의 검증 주석 참조.

---

## 4. 드리프트 방지 게이트 (CI)

`.github/migration-journal-gate.ts` 가 `supabase/migrations/*.sql` 의 모든 파일이
`_journal.json` 또는 `manual-migrations.json` 중 한 곳에서 추적되는지 검사한다(CI 필수 게이트).

**신규 마이그레이션 추가 절차:**

1. drizzle generate 산출물이면 → `_journal.json` 에 자동 등재(별도 작업 없음).
2. MCP `apply_migration`/직접 SQL 로 적용하는 수동 마이그레이션이면
   → `supabase/migrations/manual-migrations.json` 의 `migrations` 배열에 tag(파일명에서
     `.sql` 제외) 를 추가한다. 누락 시 CI 가 fail-closed 한다.
3. MCP 로 prod DDL 적용 시 쿼리 맨 앞에 `SET LOCAL lock_timeout = '3s';` 를 둔다
   (단일 운영환경 락 hang 방지 — `memory/feedback_supabase_mcp_lock_timeout`).

> 이 게이트는 "파일은 있는데 어디에도 추적/적용 안 된" silent drift 만 잡는다.
> "manifest 엔 있는데 prod 엔 미적용"은 CI 자격증명이 없어 잡지 못하므로, 적용은
> 사람이 책임지고 수행/확인한다.
