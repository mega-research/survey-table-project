-- 문항별 이월값 불러오기 끄기.
--
-- 이전에는 담당자가 이월을 막으려면 prior_answer_condition 에 도달 불가능한 조건을
-- 걸어야 했다. 그 우회는 조건이 "거짓으로 뒤집혔다" 와 구분되지 않아 회수 로직이
-- 응답자의 입력을 지우는 사고를 냈다(2026-09-08 DQ7 매출액). 의도를 값으로 표현한다.
--
-- NULL = 불러온다(기존 동작). true = 이 문항은 이월값을 불러오지 않는다.
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS prior_answer_disabled boolean;
