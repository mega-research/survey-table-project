-- 0085: 영역 앵커 — 조사표 페이지 위의 사각형
--
-- 앵커는 질문 하나 또는 그룹 하나에 붙고, **한 대상에 여러 개**가 붙을 수 있다.
-- 그룹이 3쪽과 4쪽에 걸치는 일이 흔한데 좌표 모델이 쪽 단위라 사각형 하나로는
-- 표현할 수 없다. 대상 행에 좌표 컬럼을 직접 다는 모양을 기각한 이유가 이것이다.
--
-- 좌표는 쪽 번호 + 쪽 크기 대비 0~1 비율이다. 화면 픽셀은 저장하지 않는다.
--
-- 대상 참조는 **nullable FK 둘 + CHECK 정확히 하나**다. 종류 구분값(owner_kind)은
-- 저장하지 않고 파생한다. 다형 참조(종류 + id, FK 없음)를 기각한 이유는 하나다 —
-- FK 가 없으면 앱이 정리를 빠뜨렸을 때 고아 앵커가 남고, 그것이 다음 발행 때
-- 스냅샷에 실려 응답 화면에 유령 사각형으로 그려진다.
--
-- 좌표만 담고 R2 키를 담지 않으므로 R2 참조 표면 등재 대상이 아니다.
-- 앵커는 발행 시 버전 스냅샷에 복사해 얼린다 (ADR 0020).

create table if not exists survey_document_anchors (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references surveys(id) on delete cascade,
  document_id uuid not null references survey_documents(id) on delete cascade,

  -- 대상: 정확히 하나만 채워진다
  question_id uuid references questions(id) on delete cascade,
  group_id uuid references question_groups(id) on delete cascade,

  page integer not null,
  x double precision not null,
  y double precision not null,
  w double precision not null,
  h double precision not null,
  "order" integer not null default 0,
  created_at timestamptz not null default now(),

  constraint survey_document_anchors_owner_exactly_one
    check ((question_id is null) <> (group_id is null)),
  constraint survey_document_anchors_page_positive check (page >= 1),
  constraint survey_document_anchors_norm_range check (
    x >= 0 and x <= 1 and y >= 0 and y <= 1 and
    w > 0 and w <= 1 and h > 0 and h <= 1
  )
);

create index if not exists survey_document_anchors_survey_idx
  on survey_document_anchors(survey_id);
create index if not exists survey_document_anchors_question_idx
  on survey_document_anchors(question_id);
create index if not exists survey_document_anchors_group_idx
  on survey_document_anchors(group_id);

alter table survey_document_anchors enable row level security;
revoke all on survey_document_anchors from anon, authenticated;
