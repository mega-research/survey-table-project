import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type {
  FieldworkOrgStatus,
  SurveyGuestTabs,
  SurveyParticipantKind,
  TeamLifecycleAction,
  TeamLifecycleMetadata,
  TeamRole,
  TeamStatus,
} from '@/shared/contracts/workspace';

import { users } from './auth';
import { surveys } from './surveys';

/**
 * 팀 — 설문 소유·접근의 최소 워크스페이스이자 기본 접근 경계 (마이그레이션 0088).
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
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // 활성 팀 이름은 유일하다 — archived 는 목록에서 사라지므로 같은 이름을 다시 쓸 수 있다.
  (t) => [uniqueIndex('teams_active_name_uq').on(t.name).where(sql`${t.status} = 'active'`)],
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
 * 팀 공용 설문 그룹 — 정리용 묶음 (마이그레이션 0090, 티켓 12).
 *
 * 그룹은 **접근 권한이 아니다.** 담겼다는 사실이 설문을 누가 볼 수 있는지에 영향을 주지 않고,
 * 판정은 계속 `surveys.teamId`·`visibility`·`ownerUserId` 로만 한다. 구조 편집(생성·이름
 * 변경·정렬·삭제)은 모든 active 팀원의 공동 권한이고, 설문을 넣고 빼는 것만 그 설문의
 * `survey.edit` 을 따로 요구한다.
 *
 * 그룹은 팀 소유물이라 **설문이 팀을 옮기면 `surveys.surveyGroupId` 는 NULL 로 내려야 한다** —
 * 팀 해산(티켓 13)·재배치(14)·승계(19)가 지켜야 할 계약이다. DB 복합 FK 로 강제하지 않은
 * 이유는 0090 마이그레이션 헤더에 적었다.
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
 * 설문 단위 부여 — 참여자·게스트·실사 통합 (마이그레이션 0092, 티켓 18).
 *
 * **팀 경계를 넘는 유일한 접근 경로다.** 지금까지 설문 접근은 전부 `surveys.teamId` 를 지나
 * 판정됐는데(ADR-0006·0008) 이 테이블만 그 축 밖에 있다 — 타 팀 사람을 그 설문 하나에만
 * 들인다. 그래서 여기 행이 생기는 것과 팀 멤버십이 생기는 것은 전혀 다른 일이고,
 * 초대는 `team_members` 에 아무것도 쓰지 않는다.
 *
 * `kind` 와 `users.userType` 의 정합은 **서비스가 지킨다** — 두 테이블에 걸친 조건이라
 * CHECK 로 걸 수 없다(0092 헤더 참조).
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
 * 실사 업체 — 외주 실사 인력의 소속 경계 (마이그레이션 0093, 티켓 24).
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
