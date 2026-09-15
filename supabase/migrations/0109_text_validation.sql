-- 단답형·장문형 응답 품질 검사 — 최소 글자 수·의미 없는 입력(자음·모음·숫자만) 거부.
--
-- 입력 형식(input_type 의 휴대전화·이메일 등)이 값의 모양을 보는 것이라면 이쪽은 자유
-- 서술의 성의를 본다. "10자 이상", "ㅋㅋㅋ·123124 로는 못 넘어가게" 요구를 담는다.
-- 차단은 클라이언트에서만 한다(ADR 0023 과 같은 자리) — 저장 경로는 검증하지 않는다.
--
-- {minLength?: number, rejectMeaningless?: boolean}. NULL = 검사 없음(기존 전부).
-- nullable 컬럼 추가라 구버전 앱 INSERT 가 깨지지 않는다 — 2단계 배포 대상이 아니다.
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS text_validation jsonb;

COMMENT ON COLUMN questions.text_validation IS
  '단답형·장문형 응답 품질 검사 {minLength, rejectMeaningless}. NULL = 검사 없음.';
