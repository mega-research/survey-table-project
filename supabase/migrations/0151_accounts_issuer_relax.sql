-- 0151: accounts.issuer 를 풀어 better-auth 1.7.3+ 로 올릴 수 있게 한다. (2026-11-02)
--
-- issuer 는 better-auth 1.7.0~1.7.2 에만 있던 컬럼이다(0112 가 NOT NULL + (issuer, account_id) UNIQUE 로
-- 들였다). 1.7.3 부터 계정은 다시 1.6 처럼 (provider_id, account_id) 로 찾고 새 행에 issuer 를 쓰지
-- 않는다 — NOT NULL 이 남아 있으면 발급·연결 INSERT 가 전부 실패하고, 1.7.14 는 시작할 때 Drizzle
-- 스키마를 대조해 그 컬럼을 「쓰지 않는 필수 컬럼」으로 보고 인증 자체를 거부한다(스테이징에서 실제로
-- 로그인 화면 뒤 전 페이지가 서버 렌더 오류가 났다). 공식 1.7 업그레이드 안내의 Postgres 절차를 따른다.
--
-- 1) NOT NULL 을 푼다. 컬럼은 남긴다 — 지금 돌고 있는 1.7.1 앱이 아직 이 값을 쓰고 읽으므로, 새 앱이
--    나가기 전에 지우면 그 사이 로그인이 깨진다. 지우는 것은 새 앱 배포 뒤의 별도 단계다.
-- 2) (issuer, account_id) UNIQUE 를 지우고 1.7.3+ 의 조회 키 (provider_id, account_id) 에 UNIQUE 를 둔다.
--    better-auth 는 한 키에 행이 둘이면 조회를 거부하므로 같은 무결성을 DB 가 지킨다.
--    2026-11-02 스테이징 실측: 36행 전부 provider_id='credential', (provider_id, account_id) 중복 0.
--    소행이라 트랜잭션 안에서 CONCURRENTLY 없이 만든다.
--
-- 1.7.1 앱과도 맞는다 — 그 앱은 issuer 를 계속 채우고, (issuer, account_id) 조회는 인덱스 없이도 같은 행을 찾는다.

BEGIN;

ALTER TABLE "accounts" ALTER COLUMN "issuer" DROP NOT NULL;
DROP INDEX IF EXISTS "accounts_issuer_account_id_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_provider_id_account_id_unique"
  ON "accounts" ("provider_id", "account_id");

COMMIT;
