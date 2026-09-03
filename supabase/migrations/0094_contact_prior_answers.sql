-- 0094: 이월 응답 저장소 + 회차 라벨
--
-- 추적조사(CONTEXT.md > 추적조사): 조사 대상 한 명이 지난 회차에 문항에 답한 내용
-- 한 벌을 담는다. 조사 대상 하나당 한 행이며 회차 축을 두지 않는다 — 직전 1회차만
-- 보관한다. 누적 보관이 필요해지면 회차 키 컬럼 추가 + UNIQUE 변경으로 확장한다.
--
-- survey_responses 에 임포트하지 않는 이유: 응답 테이블을 직접 조회하는 곳이 다수이고
-- 그중 상당수가 집계성이라, 파티션 축을 하나 더 얹으면 필터를 빠뜨린 곳에서 응답률·
-- 진척률·쿼터가 조용히 틀린다. 별도 테이블이면 기존 쿼리가 구조적으로 볼 수 없다.
--
-- 실/테스트 파티션 축을 따로 두지 않는다. 이월 응답은 조사 대상에 붙으므로
-- contact_targets.is_test 를 그대로 따른다.

create table if not exists contact_prior_answers (
  id uuid primary key default gen_random_uuid(),
  contact_target_id uuid not null references contact_targets(id) on delete cascade,
  -- 응답 저장 형태(survey_responses.question_responses)와 동형. 표·복수선택·랭킹이
  -- 별도 변환 없이 들어가고, 기타/상세 기재 사이드카(__optTexts__)도 함께 담긴다.
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_prior_answers_target_unique unique (contact_target_id)
);

alter table contact_prior_answers enable row level security;
revoke all on contact_prior_answers from anon, authenticated;

-- 응답 화면 문구에 쓰는 지난 회차 라벨(예: 2025년 조사). NULL 이면 기본 문구.
-- 버전 스냅샷 밖 라이브 컬럼 — is_paused / quota_config 와 같은 취급이라
-- publish 없이 즉시 반영된다.
alter table surveys add column if not exists prior_wave_label text;
