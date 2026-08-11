-- 0071: R2 파생 참조 인덱스
--
-- 콘텐츠에서 추출한 R2 키 참조의 캐시(2026-07-31 spec §6). 유지(maintain)가
-- 아니라 재생성(rebuild)하는 구조라 드리프트 개념이 없다 — 콘텐츠가 여전히
-- 진실이고 이 테이블은 언제든 버리고 다시 만들 수 있다.
--
-- 삭제 권한 없음: 집행자는 이 인덱스로 "참조됨"을 판정해 스캔을 생략할 수만
-- 있고, "참조 없음"으로 삭제를 결정하지 않는다. 최종 판정은 콘텐츠 스캔이다.
--
-- 저장하는 것은 키 문자열뿐이며 스냅샷 본문이 아니다. 2026-07-31 실측 기준
-- 전 표면 고유 키는 약 60개.

create table if not exists r2_key_refs (
  key text not null,
  -- 참조 출처 테이블명 (surveys / questions / survey_versions / ...)
  source_table text not null,
  source_id uuid not null,
  extracted_at timestamptz not null default now(),
  constraint r2_key_refs_pk primary key (key, source_table, source_id)
);

-- PK 의 선두 컬럼이 key 라 `where key in (...)` 은 PK 인덱스로 처리된다.
-- 행 단위 교체(특정 source row 의 참조 전량 삭제)를 위한 인덱스만 별도로 둔다.
create index if not exists r2_key_refs_source_idx on r2_key_refs(source_table, source_id);

alter table r2_key_refs enable row level security;
revoke all on r2_key_refs from anon, authenticated;
