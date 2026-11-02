-- 0150: 내 태그와 태그 연결 — 한 사람이 설문에 붙이는 키워드 이름 + 색. (2026-11-02, 설문 즐겨찾기·태그 티켓 07)
--
-- personal_survey_tags      행 하나 = 한 사람의 태그 하나(이름·색). 만든 사람만 본다.
-- personal_survey_tag_links 행 하나 = 「이 태그가 이 설문에 붙어 있다」. 떼면 행을 지운다.
--
-- 이름은 사람 안에서 「앞뒤 공백 제거 + 소문자」로 유일하다 — 「A사」가 있으면 「 a사 」는 새 태그가
-- 아니라 그 태그다(만들기는 충돌하면 기존 태그를 돌려준다). 길이는 앞뒤 공백을 뗀 1~20자,
-- 색은 8색 어휘. 앱은 앞뒤 공백을 뗀 이름을 저장하지만 제약은 저장값을 다시 btrim 해 본다.
--
-- 한 사람당 300개는 **코드가** 막는다 — 태그를 만드는 유일한 경로(createTag)가 사용자 단위
-- advisory lock 아래서 센다. 트리거를 들이지 않는다.
--
-- 연결 키는 (tag_id, survey_id) 쌍이다. 붙이기는 `INSERT … ON CONFLICT DO NOTHING`, 떼기는 DELETE 라
-- 연타·재시도·탭 두 개가 같은 결과로 수렴한다. survey_id 인덱스는 설문 하드 삭제의 cascade 가
-- 이 표를 훑지 않게 한다 — PK 첫 칸이 tag_id 라 그 방향은 PK 가 못 받는다.
--
-- FK 는 전부 ON DELETE CASCADE 다(사람 → 태그 → 연결, 설문 → 연결). 개인 정리 데이터라 감사
-- 가치가 없다. 설문 soft delete(deleted_at)는 행을 건드리지 않는다 — 복구하면 태그가 돌아온다.
--
-- 색 어휘는 세 곳에 있다: 이 CHECK · 스키마 check() · shared/contracts/workspace 의 배열.
-- 대조 테스트 src/db/schema/workspace-personal-tag-color.test.ts.
--
-- 번호: 0149(즐겨찾기) 다음. 배포: 앱보다 먼저 적용한다(새 앱이 목록 조회에서 이 표를 읽는다).
-- 앱 생성 NOT NULL 컬럼이 없어 단일 단계다. 역할 모델 v2 와 함께 승격한다(staging 전용 기능).
--
-- RLS: 0035 하우스 룰 — ENABLE + 정책 0개(anon/authenticated deny-all, 앱은 postgres 롤).
-- 멱등 (IF NOT EXISTS) — 빈 DB 재생과 재적용 양쪽 안전.

BEGIN;

CREATE TABLE IF NOT EXISTS personal_survey_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT personal_survey_tags_name_length_check
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 20),
  CONSTRAINT personal_survey_tags_color_check
    CHECK (color IN ('blue', 'red', 'green', 'purple', 'amber', 'teal', 'pink', 'gray'))
);

CREATE UNIQUE INDEX IF NOT EXISTS personal_survey_tags_user_name_uq
  ON personal_survey_tags (user_id, lower(btrim(name)));

COMMENT ON TABLE personal_survey_tags IS
  '내 태그 — 한 사람이 만든 키워드 이름 + 색. 만든 사람만 본다. 사람 안에서 lower(btrim(name)) 유일, 300개 한도는 코드 (0150)';

CREATE TABLE IF NOT EXISTS personal_survey_tag_links (
  tag_id uuid NOT NULL REFERENCES personal_survey_tags (id) ON DELETE CASCADE,
  survey_id uuid NOT NULL REFERENCES surveys (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT personal_survey_tag_links_pk PRIMARY KEY (tag_id, survey_id)
);

CREATE INDEX IF NOT EXISTS personal_survey_tag_links_survey_idx
  ON personal_survey_tag_links (survey_id);

COMMENT ON TABLE personal_survey_tag_links IS
  '내 태그 연결 — 태그가 설문에 붙어 있음. 떼면 행 삭제, soft delete 는 행을 남긴다 (0150)';

ALTER TABLE personal_survey_tags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE personal_survey_tags FROM anon, authenticated;
ALTER TABLE personal_survey_tag_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE personal_survey_tag_links FROM anon, authenticated;

COMMIT;
