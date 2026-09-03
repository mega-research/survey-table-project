-- 0084: 저장된 ID 목록 — 필터 붙여넣기 대용량 경로. (2026-08-31)
--
-- 조사 대상 목록·단체 메일 위저드의 시스템ID/attrs 컬럼 검색은 URL(q)에 목록을 싣는다.
-- 요청 헤더 한계(약 16KB) 때문에 인라인은 2,000개까지이고, 그 이상은 이 테이블에 저장한 뒤
-- URL 에 `list:<uuid>` 토큰만 싣는다. 캠페인 filterSnapshot 이 토큰을 그대로 보존하므로
-- "미응답자 재발송" 재현을 위해 만료·정리는 하지 않는다 (설문 삭제 시 cascade).
--
-- ids 는 정수 배열 JSONB (중복 제거·오름차순 정렬은 앱이 보장). 접근은 서버(service role)
-- 전용 — RLS 활성 + anon/authenticated 권한 회수(0036/0065 와 같은 규칙).

BEGIN;

CREATE TABLE IF NOT EXISTS public.contact_id_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id uuid NOT NULL REFERENCES public.surveys(id) ON DELETE CASCADE,
  ids jsonb NOT NULL,
  id_count integer NOT NULL CHECK (id_count > 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_id_lists_survey_idx
  ON public.contact_id_lists (survey_id);

ALTER TABLE public.contact_id_lists ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.contact_id_lists FROM anon, authenticated;

COMMIT;
