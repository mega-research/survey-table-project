-- 문항의 「평균 산출」 (척도 평균, 2026-10-30).
-- 켜면 운영 콘솔 「실사 현황 > 척도 평균」 표에 이 문항의 단일값 변수(단일 선택 문항, 행렬 척도의 행)가
-- 완료 응답 평균·응답수 한 줄로 나온다. 응답 화면과 무관하다.
-- 기본 false 라 기존 문항은 그대로다. DEFAULT 가 있어 구버전 앱 INSERT 도 깨지지 않으므로 단일 단계 배포.
-- 앱 배포 전에 적용한다 — 새 앱이 이 컬럼을 쓴다.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS scale_mean_enabled boolean NOT NULL DEFAULT false;
