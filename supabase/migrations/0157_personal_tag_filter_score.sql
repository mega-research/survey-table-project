-- 0157: 내 태그를 검색에 건 빈도 — 설문 목록 툴바 「자주 쓰는 태그」 줄의 순서 (2026-11-09)
--
-- 태그를 검색 칩으로 걸 때마다(툴바 칩 · 「# 태그」 목록 체크 · 카드 태그 · 자동완성) 점수를 1 올리고,
-- 점수는 14일마다 절반으로 준다 — 끝난 사업 태그가 옛 클릭 수로 앞자리를 계속 차지하지 않게.
-- 감쇠는 쓰기·읽기 때 `last_filtered_at` 으로 계산하므로 주기 작업이 없다(서비스 personal-marks).
--
-- 새 칸 둘 다 기본값이 있어 구버전 앱의 INSERT 와 양립한다(2단계 배포 불필요). 앱 배포 전 적용.

BEGIN;

ALTER TABLE personal_survey_tags
  ADD COLUMN IF NOT EXISTS filter_score double precision NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_filtered_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'personal_survey_tags_filter_score_check'
  ) THEN
    ALTER TABLE personal_survey_tags
      ADD CONSTRAINT personal_survey_tags_filter_score_check CHECK (filter_score >= 0);
  END IF;
END $$;

COMMIT;
