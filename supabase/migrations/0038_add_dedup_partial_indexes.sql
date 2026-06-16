-- 0038_add_dedup_partial_indexes.sql
-- 적용: 운영 DB 적용 완료 (2026-06-16, Supabase MCP apply_migration `add_dedup_partial_indexes`).
--       drizzle _journal.json 비대상 (0020~0037 과 동일한 MCP 수동 적용 관행).
--       IF NOT EXISTS 라 이미 적용된 운영 DB 재실행에도 안전(no-op). 신규 환경 재현용으로 파일화.
--
-- 목적: 중복 응답 감지 쿼리(checkTrackB)가 survey_responses 를 필터 스캔하던 것을 인덱스로 전환.
--
-- 배경: lib/duplicate-detection/check.ts 의 checkTrackB 는 공개 응답 진입/제출 핫패스에서
--   다음 쿼리를 실행한다:
--     WHERE survey_id = ? AND deleted_at IS NULL AND completed_at IS NOT NULL
--       AND (device_id = ? OR (fp_hash = ? AND ip_hash = ?))
--   device_id / fp_hash / ip_hash 에 인덱스가 없어, 설문의 완료 응답이 쌓일수록 매 호출이
--   O(N) 필터 스캔이 된다(대형 캠페인 스파이크 시 병목). OR 두 분기를 각각 부분 인덱스로
--   받아 planner 가 bitmap-OR 로 결합하게 한다. 부분 조건(completed_at IS NOT NULL AND
--   deleted_at IS NULL)은 쿼리 술어와 일치시켜 인덱스 크기를 줄인다.
--
-- 주의: survey_responses 의 perf 인덱스는 Drizzle 스키마에 선언하지 않는 것이 이 프로젝트 관행
--   (0004/0011/0014 의 기존 인덱스도 SQL 마이그레이션에만 존재). 따라서 스키마 변경 없음.

CREATE INDEX IF NOT EXISTS idx_resp_dedup_device
  ON survey_responses (survey_id, device_id)
  WHERE completed_at IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_resp_dedup_fp_ip
  ON survey_responses (survey_id, fp_hash, ip_hash)
  WHERE completed_at IS NOT NULL AND deleted_at IS NULL;
