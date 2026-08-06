-- privateToken(응답 크레덴셜)과 분리된 공개 읽기전용 미리보기 전용 토큰.
-- 컬럼 추가 → 기존 행 백필 → DEFAULT 부착 순서로 나눠 ACCESS EXCLUSIVE 락을 짧게 유지한다
-- (컬럼 추가는 순간, 백필은 UPDATE 락, DEFAULT 부착은 다시 순간 — 풀 테이블 재작성 없음).
-- (리뷰 반영: private_token 자체가 유니크 인덱스 없이 운영되어 온 것은 이 컬럼이 따를
-- 좋은 선례가 아니라는 지적에 따라, 이 컬럼은 아래에서 별도로 유니크 인덱스를 건다 —
-- private_token 과 달리 인증 없는 공개 라우트가 직접 조회하는 키이므로 풀 스캔·중복 토큰
-- 임의 매칭을 막을 필요가 더 크다.)
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "preview_token" uuid;
UPDATE "surveys" SET "preview_token" = gen_random_uuid() WHERE "preview_token" IS NULL;
ALTER TABLE "surveys" ALTER COLUMN "preview_token" SET DEFAULT gen_random_uuid();

-- 인증 없는 공개 라우트(/preview/[token])의 조회가 풀 스캔이 되지 않도록 인덱스를 건다.
-- nullable 컬럼이므로 NULL 행은 유니크 제약에서 제외된다(다중 NULL 허용, 의도된 동작) —
-- contact_targets.invite_code(0054)와 동일한 패턴.
CREATE UNIQUE INDEX IF NOT EXISTS "surveys_preview_token_unique" ON "surveys" ("preview_token");
