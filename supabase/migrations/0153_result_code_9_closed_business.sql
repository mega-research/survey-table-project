-- 0153: 결과코드 9번 「9.전시회미참가」 → 「9.휴/폐업」. (2026-11-03)
--
-- 기본 결과코드(DEFAULT_RESULT_CODES)의 9번을 휴/폐업으로 바꾸면서, 이미 저장된 옛 이름도 함께 옮긴다.
-- 기본값을 쓰는 설문(contact_result_codes IS NULL)은 코드 쪽 기본값이 바뀌어 따라오고, 여기서는
-- 저장된 두 곳만 고친다.
--
--  ① surveys.contact_result_codes — 목록 안의 9.전시회미참가 항목을 9.휴/폐업으로 바꾼다(code·label).
--     이미 9.휴/폐업 이 있는 목록은 옛 항목을 빼기만 한다 — 같은 코드가 두 번 생기면 안 된다.
--  ② contact_attempts.result_code — 회차 기록의 옛 이름을 새 이름으로.
--
-- 대상 정보 수정 기록(contact_target_edit_logs, 0152)의 회차 스냅샷은 그때 값이라 고치지 않는다.
-- 다시 적용해도 결과가 같다(옛 이름이 남지 않으면 아무 행도 걸리지 않는다). 앱 배포 전후 무관 —
-- 옛 앱은 새 이름을 그냥 문자열 코드로 보여 준다.

BEGIN;

UPDATE public.surveys s
SET contact_result_codes = (
  SELECT coalesce(jsonb_agg(
    CASE WHEN e->>'code' = '9.전시회미참가'
      THEN e || jsonb_build_object('code', '9.휴/폐업', 'label', '9.휴/폐업')
      ELSE e END
    ORDER BY ord), '[]'::jsonb)
  FROM jsonb_array_elements(s.contact_result_codes) WITH ORDINALITY AS t(e, ord)
  WHERE NOT (
    e->>'code' = '9.전시회미참가'
    AND s.contact_result_codes @> '[{"code": "9.휴/폐업"}]'::jsonb
  )
)
WHERE jsonb_typeof(s.contact_result_codes) = 'array'
  AND s.contact_result_codes @> '[{"code": "9.전시회미참가"}]'::jsonb;

UPDATE public.contact_attempts
SET result_code = '9.휴/폐업'
WHERE result_code = '9.전시회미참가';

COMMIT;
