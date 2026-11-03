-- 0153: 결과코드 9번 「9.전시회미참가」 → 「9.휴/폐업」 — 목록에서 이미 빠진 옛 이름만. (2026-11-03)
--
-- 기본 결과코드(DEFAULT_RESULT_CODES)의 9번을 휴/폐업으로 바꾸면서, 그 설문의 결과코드 목록에 더는 없는
-- 옛 이름으로 남은 회차 기록을 새 이름으로 옮긴다. 옮기는 회차는 설문이
--   · 기본값을 쓰거나(contact_result_codes IS NULL — 기본값이 바뀌어 옛 이름이 목록에서 사라졌다)
--   · 자기 목록에 9.전시회미참가 가 없는(이미 9.휴/폐업 등으로 고친) 경우뿐이다.
-- **자기 목록에 9.전시회미참가 를 두고 쓰는 설문은 손대지 않는다** — 전시회 설문(해외전시회 성과측정 등)
-- 에서는 그 코드가 원래 뜻 그대로다. 설문 목록(surveys.contact_result_codes)은 고치지 않는다.
--
-- 대상 정보 수정 기록(contact_target_edit_logs)의 회차 스냅샷은 그때 값이라 고치지 않는다.
-- 앱 배포 **뒤**에 적용한다 — 옛 앱은 기본값 설문에 옛 이름을 계속 기록하므로, 배포 전에 적용하면 그
-- 사이 기록이 남는다. 다시 적용해도 결과가 같으니(옛 이름이 남지 않으면 아무 행도 걸리지 않는다)
-- 의심되면 한 번 더 돌린다. 빈 DB 에서는 아무 행도 걸리지 않는다.

BEGIN;

UPDATE public.contact_attempts a
SET result_code = '9.휴/폐업'
FROM public.contact_targets t
JOIN public.surveys s ON s.id = t.survey_id
WHERE a.contact_target_id = t.id
  AND a.result_code = '9.전시회미참가'
  AND (
    s.contact_result_codes IS NULL
    OR jsonb_typeof(s.contact_result_codes) <> 'array'
    OR NOT s.contact_result_codes @> '[{"code": "9.전시회미참가"}]'::jsonb
  );

COMMIT;
