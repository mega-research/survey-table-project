-- 0040_survey_list_indexes.sql
-- 적용: 운영 DB 수동 적용 대상 (Supabase MCP apply_migration 또는 직접 SQL).
--       drizzle _journal.json 비대상 (0020~0039 수동 마이그레이션 관행).
--       IF NOT EXISTS 로 재실행 안전(no-op). 신규 환경 재현용으로 파일화.
--
-- 목적: 설문 목록 API(/api/rpc/surveyBuilder/read/list)의 핫패스 최적화.
--
-- 쿼리 패턴:
--   1) surveys 목록: ORDER BY created_at DESC, 목록 projection 만 조회.
--   2) survey_responses 응답 집계:
--      WHERE deleted_at IS NULL AND survey_id IN (...)
--      GROUP BY survey_id
--      count(*) + count(*) FILTER (WHERE is_completed = true)
--
-- partial index 는 soft-deleted 응답을 제외해 인덱스 크기를 줄이고, survey_id/is_completed
-- 두 값만으로 목록 집계가 index-only scan 후보가 되게 한다.

CREATE INDEX IF NOT EXISTS idx_surveys_created_at_desc
  ON surveys (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_survey_responses_active_survey_completed
  ON survey_responses (survey_id, is_completed)
  WHERE deleted_at IS NULL;
