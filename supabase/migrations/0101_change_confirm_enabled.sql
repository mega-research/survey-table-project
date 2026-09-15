-- 문항별 변동 확인 스위치 (추적조사)
--
-- 켜면 지금 동작 그대로다 — 이월 값이 있는 문항이 잠긴 채 표시되고, 응답자가
-- 같음/달라짐을 밝혀야 다음 페이지로 넘어가며, 내보내기에 _CHG 변수가 붙는다.
-- 끄면 이월 값이 표시되는 문항의 답으로 미리 깔리고 응답자가 고치면 덮어쓴다.
--
-- 기본이 false 인 이유: 마에스트로 2026 이 문항마다 묻지 않기로 했고, 변경 여부는
-- 공지 문항에서 한 번만 묻는다. 새 설문이 실수로 문항별 확인을 켠 채 나가지 않게 한다.
--
-- 스냅샷 밖 라이브 컬럼이다 (is_paused·prior_wave_label 과 같은 취급). 스위치 하나
-- 바꾸려고 재발행하면 응답 중인 사람의 구조가 rebase 된다.
--
-- DB 기본값이 있으므로 구버전 앱의 INSERT 도 깨지지 않는다 — 2단계 배포 대상이 아니다.
ALTER TABLE surveys
  ADD COLUMN IF NOT EXISTS change_confirm_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN surveys.change_confirm_enabled IS
  '문항별 변동 확인 사용 여부(추적조사). false 면 이월 값을 응답에 미리 깐다. 스냅샷 밖 라이브 컬럼.';
