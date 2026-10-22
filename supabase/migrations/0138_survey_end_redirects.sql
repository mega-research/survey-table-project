-- 종료 후 이동 주소 (패널 연동)
--
-- 패널 업체가 자기 회원을 우리 설문으로 보내고, 끝나면 결과별 종료 페이지로 돌려받는다.
-- 완료(completed) · 자격미달(screened_out) · 쿼터 마감(quotaful_out) 마다 주소 하나.
-- 모양은 { completed?, screenedOut?, quotaClosed? } (shared/contracts/survey 의 SurveyEndRedirects).
-- NULL 이거나 키가 없으면 종전대로 우리 종료 화면을 보인다.
--
-- 스냅샷 밖 라이브 컬럼이다 (is_paused·prior_wave_label 과 같은 취급) — 실사 중에 패널이
-- 주소를 바꿔 보내도 재발행 없이 반영돼야 한다.
--
-- nullable 이고 기본값이 필요 없어 구버전 앱의 INSERT 도 깨지지 않는다 — 2단계 배포 대상이 아니다.
ALTER TABLE surveys
  ADD COLUMN IF NOT EXISTS end_redirects jsonb;

COMMENT ON COLUMN surveys.end_redirects IS
  '종료 후 이동 주소 { completed?, screenedOut?, quotaClosed? } — http(s) 만. 스냅샷 밖 라이브 컬럼.';
