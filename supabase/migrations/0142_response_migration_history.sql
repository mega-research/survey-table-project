-- 0142: 이관 이력 — 배포 응답 하나가 버전을 옮겨 갈 때마다 한 줄. (2026-10-23)
--
-- 응답자 재개 이관(구버전에서 진행 중이던 응답이 다시 들어올 때)과 관리자 수정 이관이 답을
-- 새 버전 구조로 통째 교체해, 그동안은 처음 출발한 버전 id(metadata.migratedFromVersionId)
-- 하나만 남았다. 이 표가 옮기기 전·후의 답과 두 버전을 남긴다 — 나중에 사람이나 AI 가 두
-- 버전 스냅샷과 나란히 놓고 본다. 실응답만 남긴다(테스트 버전은 저장마다 바뀐다).
--
-- 답 두 벌은 암호문을 「[개인정보 — 이력에 담지 않음]」 표식으로 바꾼 사본이다 — 파기 스윕
-- 대상이 아니다. 응답과 수명을 같이한다(ON DELETE CASCADE, 휴지통은 그대로 남는다).
-- 가리키는 버전의 스냅샷은 정리하지 않는다(findPrunableVersionIds).
--
-- 배포 전에 적용한다 — 새 앱이 이 표에 쓴다. 옛 관리자 수정 백업(adminEditRollback)을 이 표로
-- 옮기는 일은 배포 뒤의 0143 이 한다(배포 전에 옮기면 구버전 앱이 그 사이 새 백업을 쓴다).
-- 접근은 서버(service role) 전용 — RLS 활성 + anon/authenticated 권한 회수(0136 관례).

BEGIN;

CREATE TABLE IF NOT EXISTS public.response_migration_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id uuid NOT NULL REFERENCES public.survey_responses(id) ON DELETE CASCADE,
  survey_id uuid NOT NULL REFERENCES public.surveys(id) ON DELETE CASCADE,
  from_version_id uuid REFERENCES public.survey_versions(id) ON DELETE SET NULL,
  to_version_id uuid REFERENCES public.survey_versions(id) ON DELETE SET NULL,
  answers_before jsonb NOT NULL,
  answers_after jsonb,
  actor text NOT NULL,
  edited_by text,
  editor_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT response_migration_history_actor_check CHECK (actor IN ('respondent', 'admin'))
);

ALTER TABLE public.response_migration_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.response_migration_history FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS response_migration_history_response_idx
  ON public.response_migration_history (response_id);
-- 버전 보존 판정(not exists)용
CREATE INDEX IF NOT EXISTS response_migration_history_from_version_idx
  ON public.response_migration_history (from_version_id)
  WHERE from_version_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS response_migration_history_to_version_idx
  ON public.response_migration_history (to_version_id)
  WHERE to_version_id IS NOT NULL;

COMMIT;
