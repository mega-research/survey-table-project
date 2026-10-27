-- 언어별 설문 글자 — 다국어 설문(CONTEXT.md 「다국어 설문」, ADR 0034)에서 제목·설명·완료 문구·
-- 자격미달 문구의 다른 언어판. 한국어는 기존 칸(title·description·thank_you_message·
-- screened_out_message)이고 여기는 그 밖의 언어만 담는다: { zh?: {title?, description?, thankYou?,
-- screenedOut?}, en?: {...} }. 빈 칸은 한국어로 폴백한다. 발행 스냅샷 settings 에 얼린다.
-- nullable 컬럼 추가라 구버전 앱 INSERT 가 깨지지 않는다 — 2단계 배포 대상이 아니다. 앱 배포 전 적용.
ALTER TABLE surveys
  ADD COLUMN IF NOT EXISTS localized_messages jsonb;

COMMENT ON COLUMN surveys.localized_messages IS
  '언어별 설문 글자 { zh?: {title, description, thankYou, screenedOut}, en?: {...} }. NULL = 한국어만.';
