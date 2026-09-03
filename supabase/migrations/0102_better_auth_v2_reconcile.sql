-- 0102: Better Auth 선반영 테이블 ↔ 1.7 어댑터 기대 정합 + users.user_type 추가. (2026-08-25)
--
-- 적용 대상: 스테이징·프로덕션 (선반영 5테이블 위에 적용) + 빈 DB 재생(0101 직후).
--
-- 1) users.user_type — 계정 유형 'internal' | 'guest' | 'fieldwork' (ADR-0018).
--    NOT NULL 2단계 배포 규칙의 형태(nullable 추가 → 백필 → SET NOT NULL)를 한 파일 안에서
--    밟는다. 한 번에 적용해도 안전한 근거: 이 컬럼에 값을 쓰는 앱(Better Auth 스택)은 이
--    마이그레이션보다 뒤에만 배포되고, 현재 운영 앱(Supabase Auth)은 public.users 에 INSERT
--    하는 경로가 없다 — 구버전 앱 INSERT 가 깨질 표면 자체가 없다. DB DEFAULT 'internal' 이
--    있어 컬럼을 모르는 INSERT 도 항상 값을 얻는다.
--
-- 2) accounts.issuer — better-auth 1.6→1.7 에서 신설된 필수 컬럼. 이메일+비밀번호 계정은
--    'local:credential'(createLocalAccountIssuer), OAuth 는 'local:oauth:<providerId>'.
--    선반영분(1.6.23 기준)에는 없어 로그인 시 계정 조회가 실패한다. 기존 행 백필 후 NOT NULL.
--    2026-08-25 프로덕션 실측: 5행 전부 provider_id='credential'.
--
-- 3) 어댑터 기대 인덱스 — accounts(issuer, account_id) UNIQUE (findAccountByKey 유일 조회),
--    verifications(identifier) (토큰 조회). 두 테이블 모두 소행(≤5행)이라 트랜잭션 안에서
--    CONCURRENTLY 없이 생성한다.

BEGIN;

-- 1) users.user_type
ALTER TABLE "users" ADD COLUMN "user_type" text DEFAULT 'internal';
UPDATE "users" SET "user_type" = 'internal' WHERE "user_type" IS NULL;
ALTER TABLE "users" ALTER COLUMN "user_type" SET NOT NULL;
ALTER TABLE "users" ADD CONSTRAINT "users_user_type_check"
  CHECK ("user_type" IN ('internal', 'guest', 'fieldwork'));

-- 2) accounts.issuer
ALTER TABLE "accounts" ADD COLUMN "issuer" text;
UPDATE "accounts" SET "issuer" = CASE
  WHEN "provider_id" = 'credential' THEN 'local:credential'
  ELSE 'local:oauth:' || "provider_id"
END
WHERE "issuer" IS NULL;
ALTER TABLE "accounts" ALTER COLUMN "issuer" SET NOT NULL;

-- 3) 어댑터 기대 인덱스
CREATE UNIQUE INDEX "accounts_issuer_account_id_unique" ON "accounts" ("issuer", "account_id");
CREATE INDEX "verifications_identifier_idx" ON "verifications" ("identifier");

COMMIT;
