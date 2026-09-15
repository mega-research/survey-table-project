-- 자격미달 종료 문구 — 종료 결과가 screened_out 일 때 완료 화면에 보이는 설문 단위 문구.
-- 완료 문구(thank_you_message)와 같은 자리(설문 설정, 발행 스냅샷)이며 비어 있으면 완료
-- 문구로 폴백한다 — 기존 설문은 채우기 전까지 아무것도 달라지지 않는다. 내장 기본 문구는
-- 두지 않는다(설문마다 다르다). CONTEXT.md 「자격미달 종료 문구」.
-- nullable 컬럼 추가라 구버전 앱 INSERT 가 깨지지 않는다 — 2단계 배포 대상이 아니다.
ALTER TABLE surveys
  ADD COLUMN IF NOT EXISTS screened_out_message text;

COMMENT ON COLUMN surveys.screened_out_message IS
  '자격미달 종료 문구. NULL/빈 문자열 = 완료 문구(thank_you_message)로 폴백.';
