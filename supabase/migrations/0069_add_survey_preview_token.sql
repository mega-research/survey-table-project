-- privateToken(응답 크레덴셜)과 분리된 공개 읽기전용 미리보기 전용 토큰.
-- 컬럼 추가 → 기존 행 백필 → DEFAULT 부착 순서로 나눠 ACCESS EXCLUSIVE 락을 짧게 유지한다
-- (컬럼 추가는 순간, 백필은 UPDATE 락, DEFAULT 부착은 다시 순간 — 풀 테이블 재작성 없음).
-- private_token 과 동일하게 UNIQUE 제약을 걸지 않는다(기존 마이그레이션 전수 확인 결과
-- private_token 도 유니크 인덱스가 없음 — 이 컬럼도 동일한 결정을 그대로 따른다).
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "preview_token" uuid;
UPDATE "surveys" SET "preview_token" = gen_random_uuid() WHERE "preview_token" IS NULL;
ALTER TABLE "surveys" ALTER COLUMN "preview_token" SET DEFAULT gen_random_uuid();
