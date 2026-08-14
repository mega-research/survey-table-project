-- 0072: response_edit_logs 초기화(hard reset) 기록 지원
--
-- 초기화는 survey_responses 행을 물리 삭제하므로 response_id cascade 로는
-- "초기화했다" 기록이 남을 수 없다. 로그를 컨택 축(contact_target_id)으로도
-- 연결해 응답이 사라진 뒤에도 단건 편집의 수정/편집 현황에 마커를 보존한다.
--
-- 전 문장 멱등: drop not null 은 이미 nullable 이면 no-op, 컬럼/인덱스는
-- if not exists, FK 는 duplicate_object 무시.

alter table response_edit_logs alter column response_id drop not null;

-- 초기화 마커의 앵커. 일반 수정 로그는 null 유지 (response_id 로 연결).
alter table response_edit_logs add column if not exists contact_target_id uuid;

-- 'edit'(관리자 응답 수정) | 'reset'(응답 초기화)
alter table response_edit_logs add column if not exists action text not null default 'edit';

-- FK 는 drizzle 스키마의 순환 import 회피(surveys.ts -> contacts.ts)로
-- 스키마 파일에는 미표기, ALTER 로만 생성한다 (survey_responses.contact_target_id 관행).
do $$ begin
  alter table response_edit_logs
    add constraint response_edit_logs_contact_target_id_fk
    foreign key (contact_target_id) references contact_targets(id) on delete cascade;
exception when duplicate_object then null; end $$;

create index if not exists response_edit_logs_contact_target_idx
  on response_edit_logs (contact_target_id);
