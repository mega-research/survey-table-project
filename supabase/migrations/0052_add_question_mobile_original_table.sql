-- 모바일에서도 원본 표 레이아웃(가로 스크롤)으로 표시할지 여부.
-- 테이블 타입 + 설명 테이블 소스(radio/checkbox) 질문 전용. 기본 false = 카드/스테퍼 전환.
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "mobile_original_table" boolean DEFAULT false;
