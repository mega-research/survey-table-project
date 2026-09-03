-- 이월 응답 임포트 확정 설정 (추적조사)
--
-- 191개 컬럼 매핑을 한 번에 맞출 리 없으므로 재업로드는 정상 경로다. 사람이 화면에서
-- 확정한 블록↔문항 매핑과 "안 맞은 원본 값 → 선택지" 대응을 설문에 보관해, 다시 올릴 때
-- 그대로 재사용한다.
--
-- 버전 스냅샷 밖 라이브 컬럼이다 — 임포트 설정은 응답 구조가 아니라 운영 설정이라
-- publish 와 무관하게 바뀐다 (quota_config·is_paused 와 같은 취급).
--
-- 형태:
--   {
--     "blockMappings": { "<정규화 문항코드>": "<questionId>" },
--     "valueAliases":  { "<questionId>": { "<원본 값>": "<선택지 저장값>" } }
--   }
ALTER TABLE surveys
  ADD COLUMN IF NOT EXISTS prior_answer_import_config jsonb;

COMMENT ON COLUMN surveys.prior_answer_import_config IS
  '이월 응답 임포트 확정 매핑과 값 대응 (추적조사). NULL = 확정된 것 없음.';
