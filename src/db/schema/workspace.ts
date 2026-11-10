import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type {
  AccessLinkKind,
  ClientLinkTabs,
  ClientResponseColumns,
  FieldworkOrgStatus,
  PersonalTagColor,
  SurveyGuestTabs,
  SurveyParticipantAccessLevel,
  SurveyParticipantKind,
  TeamKind,
  TeamLifecycleAction,
  TeamLifecycleMetadata,
  TeamRole,
  TeamStatus,
} from '@/shared/contracts/workspace';
import type { ContactAssignmentClause } from '@/shared/contracts/contacts';

import { users } from './auth';
import { contactTargets } from './contacts';
import { surveys } from './surveys';

/**
 * 팀 — 설문 소유·접근의 최소 워크스페이스이자 기본 접근 경계 (마이그레이션 0115).
 *
 * 이름은 전체 조직 경로를 포함하지만(`연구1본부 - 1팀`) 권한 판정은 언제나 id 로 한다
 * (ADR-0008). 「메가리서치」(시스템 전체 보기)는 팀이 아니라 이 테이블에 행이 없다(ADR-0006).
 * 해산은 하드 삭제가 아니라 status='archived' 전환이다(ADR-0011, 티켓 13).
 */
export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    order: integer('order').notNull().default(0),
    status: text('status').$type<TeamStatus>().notNull().default('active'),
    /** 팀 종류 (0139) — 사이드바 표시 전용. 권한 판정은 읽지 않는다. CHECK 는 마이그레이션에 있다. */
    kind: text('kind').$type<TeamKind>().notNull().default('standard'),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // 활성 팀 이름은 유일하다 — archived 는 목록에서 사라지므로 같은 이름을 다시 쓸 수 있다.
  (t) => [
    uniqueIndex('teams_active_name_uq')
      .on(t.name)
      .where(sql`${t.status} = 'active'`),
  ],
);

/**
 * 팀 멤버십 — 소속의 단일 정본(ADR-0008).
 *
 * archived 팀의 행은 감사용으로 남기고 **유효 소속 계산에서 뺀다** — 해산 즉시 팀원은
 * 미배치가 된다(ADR-0011). 서로 다른 팀에 동시 소속(겸직)은 허용이라 user_id 단독
 * UNIQUE 는 없다. 겸직을 만들 수 있는 사람은 서비스 레이어가 좁힌다(슈퍼어드민 전용).
 */
export const teamMembers = pgTable(
  'team_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: text('role').$type<TeamRole>().notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('team_members_team_user_uq').on(t.teamId, t.userId),
    index('team_members_user_id_idx').on(t.userId),
  ],
);

/**
 * 팀 감사 기록 — 팀 자체(create/rename/dissolve)와 멤버 구성(member_*).
 * 수정·삭제하지 않는 append-only 테이블이다.
 */
export const teamLifecycleEvents = pgTable(
  'team_lifecycle_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    action: text('action').$type<TeamLifecycleAction>().notNull(),
    /** 멤버 사건의 대상. 팀 자체 사건에서는 null 이다. */
    targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'restrict' }),
    changedBy: uuid('changed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    metadata: jsonb('metadata').$type<TeamLifecycleMetadata>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('team_lifecycle_events_team_idx').on(t.teamId)],
);

/**
 * 팀 공용 설문 그룹 — 정리용 묶음 (마이그레이션 0117, 티켓 12).
 *
 * 그룹은 **접근 권한이 아니다.** 담겼다는 사실이 설문을 누가 볼 수 있는지에 영향을 주지 않고,
 * 판정은 계속 `surveys.teamId`·`visibility`·`ownerUserId` 로만 한다. 구조 편집(생성·이름
 * 변경·정렬·삭제)은 모든 active 팀원의 공동 권한이고, 설문을 넣고 빼는 것만 그 설문의
 * `survey.edit` 을 따로 요구한다.
 *
 * 그룹은 팀 소유물이라 **설문이 팀을 옮기면 `surveys.surveyGroupId` 는 NULL 로 내려야 한다** —
 * 팀 해산(티켓 13)·재배치(14)·승계(19)가 지켜야 할 계약이다. DB 복합 FK 로 강제하지 않은
 * 이유는 0117 마이그레이션 헤더에 적었다.
 */
export const surveyGroups = pgTable(
  'survey_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    order: integer('order').notNull().default(0),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // 그룹 이름은 팀 안에서만 유일하다 — 여러 팀이 같은 이름의 그룹을 갖는 것이 정상이다.
  (t) => [
    uniqueIndex('survey_groups_team_name_uq').on(t.teamId, t.name),
    index('survey_groups_team_order_idx').on(t.teamId, t.order),
  ],
);

/**
 * 설문 단위 부여 — 참여자·게스트·실사 통합 (마이그레이션 0119, 티켓 18).
 *
 * **팀 경계를 넘는 유일한 접근 경로다.** 지금까지 설문 접근은 전부 `surveys.teamId` 를 지나
 * 판정됐는데(ADR-0006·0008) 이 테이블만 그 축 밖에 있다 — 타 팀 사람을 그 설문 하나에만
 * 들인다. 그래서 여기 행이 생기는 것과 팀 멤버십이 생기는 것은 전혀 다른 일이고,
 * 초대는 `team_members` 에 아무것도 쓰지 않는다.
 *
 * `kind` 와 `users.userType` 의 정합은 **서비스가 지킨다** — 두 테이블에 걸친 조건이라
 * CHECK 로 걸 수 없다(0119 헤더 참조).
 */
export const surveyParticipants = pgTable(
  'survey_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 설문이 하드 삭제되면 부여도 의미가 없다 — 앱의 삭제는 soft 라 사실상 안 쓰이는 경로다. */
    surveyId: uuid('survey_id')
      .notNull()
      .references(() => surveys.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    kind: text('kind').$type<SurveyParticipantKind>().notNull(),
    /** kind='guest' 전용 현황 탭 화이트리스트 — 티켓 21 이 소비한다. */
    guestTabs: jsonb('guest_tabs').$type<SurveyGuestTabs>(),
    /**
     * kind='member' 전용 권한 등급 (0123). 초대자가 참여자 열 전부를 갖지 않았으면 limited —
     * 참여자 열과 팀원 열의 교집합만 선다. 다른 kind 에서는 판정이 읽지 않는다.
     */
    accessLevel: text('access_level')
      .$type<SurveyParticipantAccessLevel>()
      .notNull()
      .default('full'),
    addedBy: uuid('added_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 한 사람이 한 설문에 두 자격으로 서지 않는다 — kind 를 키에 넣지 않는 것이 의도다.
    uniqueIndex('survey_participants_survey_user_uq').on(t.surveyId, t.userId),
    index('survey_participants_survey_kind_idx').on(t.surveyId, t.kind),
    // "내가 초대받은 설문" 을 뒤집어 읽는 목록 조회가 이 인덱스를 탄다.
    index('survey_participants_user_idx').on(t.userId),
  ],
);

/**
 * 설문 접속 링크 — 설문 하나에 대한 **접속 수단** (마이그레이션 0126·0134, ADR-0026·0029).
 *
 * 계정이 아니다. 연구원이 설문마다 전용 URL 하나와 공유 비밀번호 하나를 만들어 전달하고, 받은
 * 쪽은 그 링크로 그 설문에 들어온다 — 업체도 담당자도 고객사도 시스템에 등록하지 않는다.
 * 한 접속 수단을 여럿이 돌려쓰므로 사람 단위 귀속이 처음부터 성립하지 않고, 그래서 귀속의
 * 단위를 사람에서 링크로 내렸다(ADR-0019 를 대체).
 *
 * **`kind` 가 종류를 가른다** — 외주 실사 링크(`fieldwork`)와 클라이언트 링크(`client`).
 * 활성 클라이언트 링크는 설문당 하나, 외주 링크는 업체 수만큼 선다(0159, ADR-0035). 테이블 이름이 종류 중립인 것은 0134 가 옛 이름
 * (`survey_fieldwork_links`)에서 옮겼기 때문이다. 귀속 칸(`fieldwork_link_id`)은 외주 링크만
 * 채우므로 이름을 그대로 뒀다.
 *
 * **만료일 컬럼이 없다** — 설문 상태가 그 일을 한다(중단·종료). 판정은 `server/survey-access`
 * 의 링크 분기와 `server/access-link` 의 세션 판정이 함께 하며, 둘 다 링크 행을 건드리지 않아
 * 재개·종료 취소가 같은 링크를 그대로 되살린다.
 *
 * **`token` 을 UPDATE 하지 말 것.** 주소는 영구 고정이고 재발급 경로가 없다 — 사람을 막는
 * 일(유출·업체 교체·담당자 교체)은 전부 비밀번호 변경이 진다.
 *
 * `passwordCipher` 는 **가역 암호화**다(해시가 아니다). 공유 출입 암호라 연구원이 다시 읽어
 * 답해 줄 수 있어야 한다.
 */
export const surveyAccessLinks = pgTable(
  'survey_access_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * 종류 — 0134 의 CHECK 가 어휘를 지킨다(`accessLinkKindValues`). 기본값이 `fieldwork` 인
     * 것은 이 컬럼이 생기기 전의 행이 전부 외주 링크였기 때문이다.
     */
    kind: text('kind').$type<AccessLinkKind>().notNull().default('fieldwork'),
    /** 설문이 하드 삭제되면 접속 수단도 의미가 없다 — 참여 행과 같은 판단이다. */
    surveyId: uuid('survey_id')
      .notNull()
      .references(() => surveys.id, { onDelete: 'cascade' }),
    /** 주소에 실리는 값. 전역 유일하고 한 번 정해지면 바뀌지 않는다. */
    token: text('token').notNull(),
    /** 가역 암호화된 공유 비밀번호. lib/crypto 의 공유 비밀 래퍼가 읽고 쓴다. */
    passwordCipher: text('password_cipher').notNull(),
    /**
     * 세션 폐기 표식 — 링크 세션 쿠키가 이 값을 들고 다니며 매 요청 대조한다.
     * 비밀번호를 바꾸면 이미 들어와 있던 세션이 그 순간 끊긴다(시각 비교가 아니라 값 일치).
     */
    passwordUpdatedAt: timestamp('password_updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    passwordUpdatedBy: uuid('password_updated_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /**
     * 종료. 행을 지우지 않는 이유는 종료된 링크가 「그 링크가 무엇을 넣었는가」의 계보이기
     * 때문이다 — 활성 UNIQUE 가 부분 인덱스라 종료 뒤 재발급이 된다. 귀속 칸이 붙으면
     * RESTRICT FK 가 하드 삭제를 DB 에서도 막지만, **그 칸은 아직 없다.**
     */
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by').references(() => users.id, { onDelete: 'restrict' }),
    /**
     * 클라이언트 링크의 현황 탭 화이트리스트 — **`kind='client'` 전용**(0134 CHECK 가 외주
     * 링크에서 NULL 을 강제한다). NULL 이면 기본값(응답 현황 하나)이고, 읽는 쪽은
     * `normalizeClientLinkTabs` 로 접는다 — 참여 행의 `guest_tabs` 넷에 칩 셋(설문 보기·상세 통계·
     * 응답 내역)을 더한 어휘다.
     */
    clientTabs: jsonb('client_tabs').$type<ClientLinkTabs>(),
    /**
     * 클라이언트 링크 응답 내역의 열 `{version, keys}` — **`kind='client'` 전용**(0148 CHECK).
     * NULL 이면 기본 열이고 version 0 이다. 읽는 쪽은 `normalizeClientResponseColumns` 로 접고,
     * 열 키의 허용 판정은 쓰기·읽기 모두 `isClientResponseColumnAllowed` 하나를 부른다.
     */
    clientResponseColumns: jsonb('client_response_columns').$type<ClientResponseColumns>(),
    /**
     * 외주 링크의 **연구원용 이름표**(「프롬」·「프라임」) — `kind='fieldwork'` 전용, 1~40자(0159 CHECK).
     * 업체를 개체로 등록하지 않으므로(ADR-0026·0035) 링크가 여럿일 때 내부 화면이 이것으로 구별한다.
     * NULL 이면 발급 순번(`fieldworkLinkName`)으로 부른다. **외주 콘솔·비밀번호 화면·링크 세션이 여는
     * 어떤 응답 모양에도 싣지 않는다** — 링크 세션 쪽 조회(`server/access-link`)는 이 칸을 고르지 않는다.
     */
    label: text('label'),
    /**
     * 담당 범위를 **나눈 적 있음**(0160, ADR-0035) — `kind='fieldwork'` 전용. NULL 이면 한 번도 나누지
     * 않은 링크라 설문 전체를 보고, 값이 있으면 `fieldworkLinkShares` 의 대상만 본다(0명이어도 0명).
     * 「범위 0명」과 「한 번도 안 나눔」을 가르는 유일한 재료다. 「담당 범위 없애기」가 NULL 로 되돌린다.
     * 링크 세션 판정(`server/access-link`)이 매 요청 이 칸을 읽어 주체에 싣는다.
     */
    shareAppliedAt: timestamp('share_applied_at', { withTimezone: true }),
    /** 마지막으로 적용한 담당 범위 조건 — 수정 화면을 다시 열면 채운다. `shareAppliedAt` 과 함께 서고 함께 빈다(0160 CHECK). */
    shareClauses: jsonb('share_clauses').$type<ContactAssignmentClause[]>(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('survey_access_links_token_uq').on(t.token),
    // 활성 **클라이언트** 링크는 설문당 하나 — 외주 링크는 업체 수만큼 선다(0159).
    // 부분 인덱스라 종료된 행은 감사로 남고 재발급이 된다.
    uniqueIndex('survey_access_links_active_client_uq')
      .on(t.surveyId)
      .where(sql`kind = 'client' AND closed_at IS NULL`),
    // 목록 조회(설문 + 종류의 열린 링크)의 자리 — 0134 의 유일 인덱스가 하던 일을 잇는다.
    index('survey_access_links_active_survey_kind_idx')
      .on(t.surveyId, t.kind)
      .where(sql`closed_at IS NULL`),
    // 0159 · 0160 CHECK 의 사본(루트 AGENTS.md 주의사항 1) — 대조는 workspace-access-link-checks.test.ts.
    check(
      'survey_access_links_label_check',
      sql`${t.label} IS NULL OR (${t.kind} = 'fieldwork' AND char_length(${t.label}) BETWEEN 1 AND 40)`,
    ),
    check(
      'survey_access_links_share_check',
      sql`(${t.shareAppliedAt} IS NULL) = (${t.shareClauses} IS NULL) AND (${t.shareAppliedAt} IS NULL OR ${t.kind} = 'fieldwork')`,
    ),
  ],
);

/**
 * 외주 실사 링크의 **담당 범위** — 조사 대상 × 외주 링크 (마이그레이션 0160, ADR-0035).
 *
 * 행 하나 = 「이 대상은 지금 이 링크에 맡겨져 있다」. 같이 맡기기 때문에 다대다다. 컨택원 배정과 다른
 * 층이라 컨택원 교체 적용은 이 표를 건드리지 않는다. 읽는 자리는 담당 범위 해석(`server/fieldwork-share`)
 * 의 술어 조각, 행을 넣는 자리는 나누기 적용(`server/contacts/services/fieldwork-shares`) 하나, 링크 하나를
 * 통째로 푸는 자리는 코어 `server/fieldwork-share-write` 의 `releaseLinkShares`(없애기·링크 종료)다.
 *
 * - 대상 FK 는 CASCADE — 명단 교체 업로드가 대상을 지우면 범위가 풀린다.
 * - 링크 FK 는 NO ACTION(문장 끝 검사) — 링크 행은 지우지 않으므로 RESTRICT 와 같은 뜻이고, 설문 하드
 *   삭제의 cascade 순서에 흔들리지 않는다.
 * - 「실데이터 대상만 · 외주 링크만 · 같은 설문」은 교차 테이블 조건이라 DB 가 아니라 쓰기 서비스가 막는다.
 */
export const fieldworkLinkShares = pgTable(
  'fieldwork_link_shares',
  {
    linkId: uuid('link_id')
      .notNull()
      .references(() => surveyAccessLinks.id),
    contactTargetId: uuid('contact_target_id')
      .notNull()
      .references(() => contactTargets.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'fieldwork_link_shares_pk', columns: [t.linkId, t.contactTargetId] }),
    // 대상 쪽 — 겹침 집계와 대상 삭제 cascade 가 이 표를 훑지 않게. PK 첫 칸이 link_id 라 그 방향은 못 받는다.
    index('fieldwork_link_shares_target_idx').on(t.contactTargetId),
  ],
);

/**
 * 실사 업체 — 외주 실사 인력의 소속 경계 (마이그레이션 0120, 티켓 24).
 *
 * **팀이 아니다.** 설문을 소유하지 않고(`surveys.teamId` 는 이 테이블을 가리키지 않는다)
 * 팀 멤버십을 만들지 않으며 재배치 목적지가 될 수 없다(ADR-0019). 이름·상태만 갖는
 * 가벼운 엔티티이고, 하는 일은 「이 실사 계정이 어느 업체 사람인가」 하나뿐이다.
 *
 * `users.fieldworkOrgId` 가 이 테이블을 가리키지만 그쪽에는 drizzle `.references()` 가
 * 없다 — `auth.ts` 가 이 파일을 import 하면 순환이 된다(이 파일이 `users` 를 쓴다).
 * FK 는 마이그레이션의 ALTER TABLE 이 만든다(`survey_responses.contactTargetId` 와 같은
 * 선례). 이 파일 밖에서 그 컬럼에 `.references()` 를 붙이지 말 것.
 *
 * 종료는 팀 해산과 같은 판단이다 — 행을 지우지 않고 archived 로 내린다. 소속 계정이
 * 계보로 남아 있어야 「누가 어느 업체 사람이었는가」를 되짚을 수 있다.
 */
export const fieldworkOrgs = pgTable(
  'fieldwork_orgs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    status: text('status').$type<FieldworkOrgStatus>().notNull().default('active'),
    /** 운영 메모 — 연락 담당자·계약 메모 등 자유 입력. 판정에 쓰지 않는다. */
    memo: text('memo'),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 활성 업체 이름만 유일하다 — archived 이름은 다시 쓸 수 있다(teams 와 같은 관례).
    uniqueIndex('fieldwork_orgs_active_name_uq')
      .on(t.name)
      .where(sql`${t.status} = 'active'`),
  ],
);

/**
 * 설문 즐겨찾기 — 한 사람이 설문 하나에 켜는 **개인 표시** (마이그레이션 0149, 설문 즐겨찾기·태그 티켓 06).
 *
 * 행이 있으면 켜짐, 없으면 꺼짐 — 상태 컬럼이 없다. 쓰기는 결과 상태 지정이다(켜기는
 * `ON CONFLICT DO NOTHING` 삽입, 끄기는 삭제)라 연타·재시도가 같은 결과로 수렴한다.
 * 나에게만 보인다: 읽는 자리는 언제나 `user_id = 요청자` 로 건다.
 *
 * FK 는 둘 다 cascade — 개인 정리 데이터라 감사 가치가 없다. 설문 soft delete 는 행을 남겨
 * 복구하면 별이 돌아온다. 쓰기는 `server/workspace/services/personal-marks`, 읽기(목록 조건·
 * 카드 표시)는 `server/read-models/survey-list-page` 가 「타 도메인 테이블 직접 쿼리」로 한다.
 */
export const surveyFavorites = pgTable(
  'survey_favorites',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    surveyId: uuid('survey_id')
      .notNull()
      .references(() => surveys.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'survey_favorites_pk', columns: [t.userId, t.surveyId] }),
    // 설문 하드 삭제의 cascade 가 이 표를 훑지 않게 — PK 첫 칸이 user_id 라 그 방향은 못 받는다.
    index('survey_favorites_survey_idx').on(t.surveyId),
  ],
);

/**
 * 내 태그 — 한 사람이 만든 키워드 이름 + 색 (마이그레이션 0150, 설문 즐겨찾기·태그 티켓 07).
 *
 * 만든 사람만 본다 — 읽는 자리는 언제나 `user_id = 요청자` 로 건다. 이름은 사람 안에서
 * `lower(btrim(name))` 로 유일하고(「A사」와 「 a사 」는 같은 태그), 길이 1~20자·색 8색은 DB CHECK 다.
 * 한 사람당 300개는 코드가 막는다(만들기가 사용자 advisory lock 아래서 센다).
 *
 * 색 CHECK 는 어휘 배열(`personalTagColorValues`)·마이그레이션 0150 과 같은 목록의 사본이다 —
 * 대조는 `workspace-personal-tag-color.test.ts`.
 */
export const personalSurveyTags = pgTable(
  'personal_survey_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').$type<PersonalTagColor>().notNull(),
    // 검색에 건 빈도(0157) — 걸 때마다 +1, 14일마다 절반. 감쇠는 last_filtered_at 으로 계산한다.
    filterScore: doublePrecision('filter_score').notNull().default(0),
    lastFilteredAt: timestamp('last_filtered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('personal_survey_tags_user_name_uq').on(t.userId, sql`lower(btrim(${t.name}))`),
    check(
      'personal_survey_tags_name_length_check',
      sql`char_length(btrim(${t.name})) BETWEEN 1 AND 20`,
    ),
    check(
      'personal_survey_tags_color_check',
      sql`${t.color} IN ('blue', 'red', 'green', 'purple', 'amber', 'teal', 'pink', 'gray')`,
    ),
    check('personal_survey_tags_filter_score_check', sql`${t.filterScore} >= 0`),
  ],
);

/**
 * 내 태그 연결 — 태그가 설문에 붙어 있음 (마이그레이션 0150, 티켓 07).
 *
 * 행이 있으면 붙음. 쓰기는 즐겨찾기와 같은 결과 상태 지정이다. FK 는 둘 다 cascade(태그를 지우면
 * 연결도, 설문을 하드 삭제하면 연결도 사라진다). 설문 soft delete 는 행을 남긴다.
 */
export const personalSurveyTagLinks = pgTable(
  'personal_survey_tag_links',
  {
    tagId: uuid('tag_id')
      .notNull()
      .references(() => personalSurveyTags.id, { onDelete: 'cascade' }),
    surveyId: uuid('survey_id')
      .notNull()
      .references(() => surveys.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'personal_survey_tag_links_pk', columns: [t.tagId, t.surveyId] }),
    // 설문 하드 삭제의 cascade 가 이 표를 훑지 않게 — PK 첫 칸이 tag_id 라 그 방향은 못 받는다.
    index('personal_survey_tag_links_survey_idx').on(t.surveyId),
  ],
);
