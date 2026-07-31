-- 0067: survey_versions.snapshot nullable + pruned_at
--
-- 버전 보존 정책(2026-07-31 spec). 응답이 가리키지 않는 버전의 snapshot 을
-- NULL 로 비워 스캔 표면과 저장 용량을 회수한다. 행 자체는 남긴다 —
-- survey_responses.version_id 에 FK 가 없어(순환 import 회피로 의도적 생략)
-- 행을 지우면 조용히 깨진 참조가 남기 때문이다.
--
-- 전 문장 멱등: drop not null 은 이미 nullable 이면 no-op.

alter table survey_versions alter column snapshot drop not null;

-- "정리됨"과 "원래 비어 있음"을 구분하는 관측용 컬럼
alter table survey_versions add column if not exists pruned_at timestamptz;
