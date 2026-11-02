-- 0149: 설문 즐겨찾기 — 한 사람이 설문 하나에 켜는 개인 표시. (2026-11-02, 설문 즐겨찾기·태그 티켓 06)
--
-- 행 하나 = 「이 사람은 이 설문에 별을 켰다」. 끄면 행을 지운다(상태 컬럼이 없다). 목록 순서를
-- 바꾸지 않고, 나에게만 보인다 — 목록 조회가 요청자 user_id 로만 읽는다.
--
-- 키는 (user_id, survey_id) 쌍이다. 켜기는 `INSERT … ON CONFLICT DO NOTHING`, 끄기는 DELETE 라
-- 연타·재시도·탭 두 개가 같은 결과로 수렴한다(결과 상태 지정). survey_id 인덱스는 설문 하드
-- 삭제의 cascade 가 이 표를 훑지 않게 한다 — PK 의 첫 칸이 user_id 라 그 방향은 PK 가 못 받는다.
--
-- FK 는 둘 다 ON DELETE CASCADE 다. 개인 정리 데이터라 감사 가치가 없다. 설문 soft delete
-- (deleted_at)는 행을 건드리지 않는다 — 복구하면 별이 돌아온다. 볼 수 없게 된 설문의 별도 남지만
-- 목록의 원천이 작업 범위라 화면에 나오지 않고, 다시 볼 수 있게 되면 돌아온다.
--
-- 번호: 0147 은 main(척도 평균), 0148 은 staging(클라이언트 응답 열)이 썼다.
-- 배포: 앱보다 먼저 적용한다(새 앱이 목록 조회에서 이 표를 읽는다). 앱 생성 NOT NULL 컬럼이
-- 없어 단일 단계다. 역할 모델 v2 와 함께 승격한다(staging 전용 기능).
--
-- RLS: 0035 하우스 룰 — ENABLE + 정책 0개(anon/authenticated deny-all, 앱은 postgres 롤).
-- 멱등 (IF NOT EXISTS) — 빈 DB 재생과 재적용 양쪽 안전.

BEGIN;

CREATE TABLE IF NOT EXISTS survey_favorites (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  survey_id uuid NOT NULL REFERENCES surveys (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT survey_favorites_pk PRIMARY KEY (user_id, survey_id)
);

CREATE INDEX IF NOT EXISTS survey_favorites_survey_idx
  ON survey_favorites (survey_id);

COMMENT ON TABLE survey_favorites IS
  '설문 즐겨찾기 — 한 사람이 설문 하나에 켜는 개인 표시. 끄면 행 삭제, soft delete 는 행을 남긴다 (0149)';

ALTER TABLE survey_favorites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE survey_favorites FROM anon, authenticated;

COMMIT;
