-- test_token 을 uuid 에서 text 로 변경하고, 기존 토큰을 짧은 값으로 재생성한다.
-- 짧은 nanoid 토큰(앱 생성)과 컬럼 타입을 맞추기 위함. rotate 가 없어 재생성하지 않으면
-- 기존 설문은 영구히 긴 UUID 토큰을 유지하므로, 여기서 일괄 단축한다.
-- 트레이드오프: 이전에 복사해둔 구 테스트 링크는 무효화된다(운영자가 UI 에서 재복사).
ALTER TABLE surveys ALTER COLUMN test_token TYPE text USING test_token::text;

UPDATE surveys
SET test_token = substr(md5(gen_random_uuid()::text), 1, 12)
WHERE test_token IS NOT NULL;
