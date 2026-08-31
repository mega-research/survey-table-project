import 'server-only';

import { type SQL, and, count, desc, eq, isNull, max, sql } from 'drizzle-orm';

import { db } from '@/db';
import {
  surveyParticipants,
  surveyResponses,
  surveys,
  teams,
  users,
} from '@/db/schema';
import type { QuotaConfig } from '@/shared/contracts/quota';
import type { FieldworkHomeSurveyItem } from '@/shared/contracts/workspace-io';

/**
 * 실사 홈이 보는 설문 목록 (.pen FLOW 10-1, 역할 모델 v2 티켓 25).
 *
 * read-model 인 이유는 여러 도메인 테이블(부여 행·설문·팀·응답)을 **읽기만** 하기 때문이다.
 *
 * 목록이 접근 판정을 다시 하지 않는 대신 **같은 조건을 건다**. 줄은 그 자리에서 열리는
 * 링크라, 코어가 거부할 설문이 목록에 서면 「눌러도 안 열리는 행」이 된다 —
 * `resolveSurveyCapabilities` 의 실사 분기가 막는 것을 그대로 옮긴다:
 *  - `deleted_at IS NULL` (삭제된 설문은 없는 것)
 *  - `assignment_status = 'assigned'` (배치 대기는 아무도 못 연다, ADR-0006)
 *  - `kind = 'fieldwork'` (참여자·게스트 행으로는 실사 자격이 서지 않는다)
 *
 * 공개 범위(visibility)는 **일부러 조건에 없다** — 실사에게는 초대가 유일한 자격이고
 * invite_only 는 소유 팀 팀원에게만 숨기는 축이다(스펙 §3).
 */

/** 이 줄이 왜 보이는가 — 화면의 「초대됨」·「업체 시야」 필과 액션이 여기서 갈린다. */
type Reason = FieldworkHomeSurveyItem['reason'];

/**
 * 내가 초대된 설문 — 실사원·팀장 공통의 기본 목록.
 *
 * 실사원에게는 이것이 전부다(.pen 10-1: 「실사원은 세그먼트가 없다」).
 */
export async function listInvitedFieldworkSurveys(
  userId: string,
): Promise<FieldworkHomeSurveyItem[]> {
  return selectFieldworkSurveys('invited', eq(surveyParticipants.userId, userId));
}

/**
 * 업체 전체 — 내 초대 + **소속원이 초대된 설문**까지 (.pen 10-1 「업체 전체 4」).
 *
 * 팀장 전용 시야다. 호출부가 역할을 확인하고 부르며, 이 함수는 **업체로만** 좁힌다 —
 * 그 경계가 파생 시야의 전부이고(ADR-0019), 업체 조건을 빼면 타 업체 설문이 그대로 넘어온다.
 *
 * 한 설문에 나와 소속원이 **둘 다** 초대돼 있으면 「초대됨」이 이긴다. 내 초대가 곧 결과코드·
 * 대행 권한이라, 그 줄을 「업체 시야」로 그리면 화면이 할 수 있는 일을 축소해서 말한다.
 * 설문 단위로 묶으면서 `bool_or(내 초대인가)` 를 함께 접는 것이 그 우선순위다.
 */
export async function listOrgFieldworkSurveys(
  userId: string,
  orgId: string,
): Promise<FieldworkHomeSurveyItem[]> {
  return selectFieldworkSurveys('org', eq(users.fieldworkOrgId, orgId), userId);
}

/**
 * 두 목록의 한 몸통.
 *
 * 초대 행에서 **시작**해 설문으로 조인한다(반대 방향이면 초대 없는 설문까지 훑는다).
 * 한 설문에 소속원이 여럿 초대돼 있을 수 있어 설문 단위로 묶는다 — 묶지 않으면 같은 설문이
 * 사람 수만큼 줄로 나온다.
 */
async function selectFieldworkSurveys(
  scope: Reason,
  participantFilter: SQL,
  viewerUserId?: string,
): Promise<FieldworkHomeSurveyItem[]> {
  // 완료 응답 수 — 진척의 분자. 응답 표를 설문 단위로 미리 접어 조인이 곱해지지 않게 한다.
  const completed = db
    .select({
      surveyId: surveyResponses.surveyId,
      value: count().as('completed_value'),
      lastActivityAt: max(surveyResponses.lastActivityAt).as('last_activity'),
    })
    .from(surveyResponses)
    .where(
      and(
        eq(surveyResponses.status, 'completed'),
        eq(surveyResponses.isTest, false),
        isNull(surveyResponses.deletedAt),
      ),
    )
    .groupBy(surveyResponses.surveyId)
    .as('completed');

  const rows = await db
    .select({
      surveyId: surveys.id,
      title: surveys.title,
      teamName: teams.name,
      ownerName: sql<string | null>`owner.name`,
      quotaConfig: surveys.quotaConfig,
      completedCount: sql<number>`coalesce(${completed.value}, 0)::int`,
      lastActivityAt: completed.lastActivityAt,
      // 내가 초대된 줄인가 — 업체 시야 목록에서만 의미가 있다. 없으면 전부 'invited'.
      mine: viewerUserId
        ? sql<boolean>`bool_or(${surveyParticipants.userId} = ${viewerUserId})`
        : sql<boolean>`true`,
      // 업체 시야 줄에 「초대 김지연」으로 적을 이름 — 내가 아닌 소속원 중 먼저 초대된 사람.
      colleagueName: viewerUserId
        ? sql<
            string | null
          >`(array_agg(${users.name} order by ${surveyParticipants.createdAt}) filter (where ${surveyParticipants.userId} <> ${viewerUserId}))[1]`
        : sql<string | null>`null`,
    })
    .from(surveyParticipants)
    .innerJoin(surveys, eq(surveys.id, surveyParticipants.surveyId))
    .innerJoin(users, eq(users.id, surveyParticipants.userId))
    .leftJoin(teams, eq(teams.id, surveys.teamId))
    .leftJoin(sql`users owner`, sql`owner.id = ${surveys.ownerUserId}`)
    .leftJoin(completed, eq(completed.surveyId, surveys.id))
    .where(
      and(
        eq(surveyParticipants.kind, 'fieldwork'),
        isNull(surveys.deletedAt),
        eq(surveys.assignmentStatus, 'assigned'),
        participantFilter,
      ),
    )
    .groupBy(
      surveys.id,
      surveys.title,
      teams.name,
      sql`owner.name`,
      surveys.quotaConfig,
      completed.value,
      completed.lastActivityAt,
    )
    .orderBy(desc(completed.lastActivityAt), desc(surveys.id));

  return rows.map((row) => ({
    surveyId: row.surveyId,
    title: row.title,
    teamName: row.teamName,
    ownerName: row.ownerName,
    // 내 초대가 있으면 언제나 'invited' — 업체 시야 목록에서도 그렇다(위 주석 참조).
    reason: (row.mine ? 'invited' : scope) as Reason,
    invitedColleagueName: row.mine ? null : row.colleagueName,
    completedCount: row.completedCount,
    targetCount: quotaTargetTotal(row.quotaConfig),
    lastActivityAt: row.lastActivityAt,
  }));
}

/**
 * 쿼터 목표 총합 — 진척의 분모 (.pen 「117 / 150」).
 *
 * 쿼터가 없거나 꺼져 있으면 null 이고 화면이 「117 / —」로 그린다. 0 으로 접지 않는 이유는
 * 「목표가 0」과 「목표가 없다」가 다른 말이기 때문이다 — 앞은 달성률 100%, 뒤는 표시 없음이다.
 */
function quotaTargetTotal(config: QuotaConfig | null): number | null {
  // enabled=false 는 「정의·집계만 하고 응답자를 막지 않는다」다 — 목표가 집행되지 않는데
  // 분모로 세우면 화면이 있지도 않은 마감을 향해 달리는 것처럼 보인다.
  if (!config?.enabled) return null;
  // 셀은 sparse 다(목표가 있는 조합만) — 합이 곧 설문 전체의 목표 표본 수다.
  const total = (config.cells ?? []).reduce((sum, cell) => sum + (cell.target ?? 0), 0);
  return total > 0 ? total : null;
}
