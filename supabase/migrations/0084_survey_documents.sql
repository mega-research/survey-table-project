-- 0084: 조사표(설문에 붙는 PDF 자료)
--
-- 문항 수요조사 형식이 도입하는 층 셋 중 첫째. 응답 화면 왼쪽에 그대로 띄울
-- PDF 를 설문에 매단다.
--
-- 설문당 여러 행을 받는 모양으로 만든다. 지금 UI 는 한 설문에 하나만 붙이지만
-- '파일럿 조사표를 함께 검토받는다'는 요구가 열려 있어, 컬럼 두 개로 붙였다가
-- 나중에 테이블로 옮기는 마이그레이션을 피한다.
--
-- file_key 는 R2 의 기존 영구 네임스페이스(survey/) 키다. 새 네임스페이스를
-- 만들지 않으므로 키 화이트리스트(lib/r2-lifecycle/key-extract)는 건드리지 않는다.
-- 대신 이 테이블은 R2 참조 표면 SSOT(lib/r2-lifecycle/reference-surface.server)에
-- 반드시 등재돼야 한다 — 빠뜨리면 조사표 파일이 유예 기간 뒤 삭제 큐에서
-- 조용히 사라진다 (ADR 0015).
--
-- 조사표는 발행 스냅샷에 넣지 않는다(라이브). 발행 뒤에도 파일을 교체할 수 있고
-- 교체 가드를 두지 않는다 — 받아들인 위험은 ADR 0016 참조.

create table if not exists survey_documents (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references surveys(id) on delete cascade,
  -- R2 영구 네임스페이스 키 (survey/document/<uuid>.pdf). 공개 URL 이 아니라 키를 저장한다.
  file_key text not null,
  -- 업로드 당시 원본 파일명 — 화면 표시 전용
  filename text not null,
  -- 업로드 시 인식한 쪽 수. 앵커의 page 는 1..page_count 범위를 가정한다.
  page_count integer not null,
  "order" integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint survey_documents_page_count_positive check (page_count > 0)
);

create index if not exists survey_documents_survey_idx
  on survey_documents(survey_id, "order");

alter table survey_documents enable row level security;
revoke all on survey_documents from anon, authenticated;
