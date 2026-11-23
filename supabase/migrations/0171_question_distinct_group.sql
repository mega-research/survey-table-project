-- 문항 사이의 중복 불가 묶음 (2026-11-23) — 같은 묶음 이름을 적은 단일 선택 문항끼리 같은 보기를 고른 채 「다음」으로
-- 넘어가지 못하게 한다(청암대 교직원 문3-10 「만족스러운 휴가제도」·문3-11 「불만족스러운 휴가제도」). 판정은 클라이언트
-- 차단 검증이고 DB 는 이름만 보관한다. NULL = 없음(기존 전부). nullable 컬럼 추가라 구버전 앱 INSERT 가 깨지지 않는다 —
-- 단일 단계 배포. 앱 배포 전에 적용한다 — 새 앱이 이 컬럼을 읽고 쓴다.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS distinct_group text;

COMMENT ON COLUMN questions.distinct_group IS
  '문항 사이의 중복 불가 묶음 이름. NULL·공백 = 없음. 같은 이름의 단일 선택 문항끼리 같은 보기를 고르면 응답 화면이 다음에서 막는다.';
