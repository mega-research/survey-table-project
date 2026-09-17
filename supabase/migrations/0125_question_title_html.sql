-- 문항 제목 서식본 — 글자 일부에 굵게·밑줄·글자색·글자 크기를 준 경우에만 둔다.
--
-- 정본은 여전히 평문 title 이다. SPSS·엑셀 라벨, 조건·쿼터 편집기의 문항 목록, 분석, 이월 응답 임포트는
-- 모두 평문을 본다. 표 셀 본문의 contentHtml 과 같은 규칙으로, 응답 화면의 제목 표시만 서식본을 우선한다.
-- NULL = 서식 없음(기존 전부). nullable 컬럼 추가라 구버전 앱 INSERT 가 깨지지 않는다 — 단일 단계 배포.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS title_html text;

COMMENT ON COLUMN questions.title_html IS
  '문항 제목 서식본(굵게·밑줄·글자색·글자 크기). 정본은 평문 title. NULL = 서식 없음.';
