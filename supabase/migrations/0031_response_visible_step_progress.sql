-- 응답자별 visible step 진척 (분기/표시조건 반영). 운영 콘솔 진행중 배지 "26/28" 표기용.
-- 응답 페이지가 첫 답변/step 이동 시 저장. 첫 답변 전·구 데이터·admin-edit 은 NULL.
ALTER TABLE "survey_responses" ADD COLUMN IF NOT EXISTS "visible_step_index" smallint;
ALTER TABLE "survey_responses" ADD COLUMN IF NOT EXISTS "visible_step_total" smallint;
