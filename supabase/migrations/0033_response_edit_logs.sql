-- 관리자 응답 수정 audit 이력 (조사 대상 단건 편집 수정/편집 현황 카드).
CREATE TABLE IF NOT EXISTS response_edit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id uuid NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
  survey_id uuid NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  edited_by text,
  editor_email text,
  changed_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  changed_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_response_edit_logs_response
  ON response_edit_logs (response_id, created_at DESC);
