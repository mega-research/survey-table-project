import 'server-only';

import { type SQL, and, desc, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { db } from '@/db';
import {
  fieldworkOrgs,
  surveyParticipants,
  surveyResponses,
  surveys,
  teams,
  users,
} from '@/db/schema';
import { sumQuotaTargets } from '@/lib/quota/quota-status-calc';
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
  defaultReason: Reason,
  participantFilter: SQL,
  viewerUserId?: string,
): Promise<FieldworkHomeSurveyItem[]> {
  /**
   * 설문 단위 진척 — 완료 수와 **최근 활동**을 한 서브쿼리에서 접는다.
   *
   * 모집단이 서로 다른 것이 요점이다. 완료 수는 `status='completed'` 만 세지만 활동 시각은
   * **모든 살아 있는 응답**을 본다 — 진행 중 응답뿐인 설문을 「활동 없음」으로 그리면
   * 한창 돌고 있는 조사가 목록 맨 아래에서 멈춘 것처럼 보인다.
   *
   * 응답 표를 먼저 접는 이유는 조인이 곱해지지 않게 하기 위해서다(초대가 여럿인 설문에서
   * 완료 수가 사람 수만큼 부풀어 오른다).
   */
  const progress = db
    .select({
      surveyId: surveyResponses.surveyId,
      completed:
        sql<number>`count(*) filter (where ${surveyResponses.status} = 'completed')::int`.as(
          'completed_value',
        ),
      lastActivityAt: sql<Date | null>`max(${surveyResponses.lastActivityAt})`.as('last_activity'),
    })
    .from(surveyResponses)
    // 파티션은 언제나 real 이다 — 외부 계정은 전역 테스트 모드를 따르지 않는다
    // (EXTERNAL_VIEWER_DATA_SCOPE, 티켓 25). 홈과 콘솔의 숫자가 갈리지 않게 여기도 고정한다.
    .where(and(eq(surveyResponses.isTest, false), isNull(surveyResponses.deletedAt)))
    .groupBy(surveyResponses.surveyId)
    .as('progress');

  // 소유자는 users 를 두 번째로 조인해 읽는다 — 첫 조인은 **초대받은 사람**이라 별칭이 필요하다.
  // 문자열 별칭 대신 alias() 를 쓰면 컬럼 이름이 바뀔 때 tsc 가 잡는다.
  const owner = alias(users, 'owner');

  const rows = await db
    .select({
      surveyId: surveys.id,
      title: surveys.title,
      teamName: teams.name,
      ownerName: owner.name,
      quotaConfig: surveys.quotaConfig,
      maxResponses: surveys.maxResponses,
      completedCount: sql<number>`coalesce(${progress.completed}, 0)::int`,
      lastActivityAt: progress.lastActivityAt,
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
    .leftJoin(owner, eq(owner.id, surveys.ownerUserId))
    .leftJoin(progress, eq(progress.surveyId, surveys.id))
    .where(
      and(
        eq(surveyParticipants.kind, 'fieldwork'),
        // **초대받은 사람이 재직 중일 때만** 센다. 퇴사·정지된 실사원의 초대 행은 남아 있고
        // (초대는 계정 상태를 따라 지워지지 않는다), 그것을 세면 아무도 뛰지 않는 설문이
        // 팀장의 업체 시야에 계속 서 있게 된다. 판정 코어의 EXISTS 도 같은 조건을 건다.
        eq(users.status, 'active'),
        isNull(surveys.deletedAt),
        eq(surveys.assignmentStatus, 'assigned'),
        participantFilter,
      ),
    )
    .groupBy(
      surveys.id,
      surveys.title,
      teams.name,
      owner.name,
      surveys.quotaConfig,
      surveys.maxResponses,
      progress.completed,
      progress.lastActivityAt,
    )
    // **NULLS LAST 가 계약이다.** Postgres 의 DESC 기본값은 NULLS FIRST 라, 그대로 두면
    // 활동이 하나도 없는 설문이 목록 맨 위를 차지한다(.pen 10-1 은 최근순이다).
    .orderBy(sql`${progress.lastActivityAt} desc nulls last`, desc(surveys.id));

  return rows.map((row) => ({
    surveyId: row.surveyId,
    title: row.title,
    teamName: row.teamName,
    ownerName: row.ownerName,
    // 내 초대가 있으면 언제나 'invited' — 업체 시야 목록에서도 그렇다(위 주석 참조).
    reason: (row.mine ? 'invited' : defaultReason) as Reason,
    invitedColleagueName: row.mine ? null : row.colleagueName,
    completedCount: row.completedCount,
    targetCount: targetOf(row.quotaConfig, row.maxResponses),
    lastActivityAt: row.lastActivityAt,
  }));
}

/**
 * 진척의 분모 (.pen 「117 / 150」) — 쿼터 목표 합, 없으면 최대 응답 수.
 *
 * 두 축을 순서대로 보는 이유는 설문마다 목표를 적는 자리가 다르기 때문이다. 쿼터를 쓰는
 * 조사는 셀 목표의 합이 곧 표본 수이고, 안 쓰는 조사는 `maxResponses` 가 그 자리다 —
 * 쿼터만 보면 후자가 영영 「117 / —」로 남는다.
 *
 * `enabled=false` 는 「정의·집계만 하고 응답자를 막지 않는다」라 분모로 세우지 않는다.
 * 목표가 집행되지 않는데 분모에 놓으면 화면이 있지도 않은 마감을 향해 달리는 것처럼 보인다.
 *
 * 둘 다 없으면 null 이고 화면이 「117 / —」로 그린다. 0 으로 접지 않는 것은 「목표가 0」과
 * 「목표가 없다」가 다른 말이기 때문이다 — 앞은 달성률 100%, 뒤는 표시 없음이다.
 */
function targetOf(config: QuotaConfig | null, maxResponses: number | null): number | null {
  if (config?.enabled) {
    // 계산의 집은 lib/quota 다 — 요약 화면과 같은 셈을 봐야 목표가 화면마다 갈리지 않는다.
    const total = sumQuotaTargets(config.cells ?? []);
    if (total > 0) return total;
  }
  return maxResponses && maxResponses > 0 ? maxResponses : null;
}

/**
 * 소속 업체의 표시 이름 — 실사 홈 헤더의 「박현우 · 그린리서치」 (.pen 10-1).
 *
 * 판정 주체(`loadAccessSubject`)는 id 만 들고 다닌다 — 이름은 판정에 쓰이지 않고, 실으면
 * 관문이 도는 모든 요청이 그 조인을 치른다. 화면이 필요할 때만 따로 읽는 것이 맞다.
 *
 * `status` 로 좁히지 않는다: 여기 도달했다는 것은 주체 로더가 이미 활성 업체를 확인했다는
 * 뜻이고(그렇지 않으면 소속이 null 이라 화면이 열리지 않는다), 조건을 두 곳에 두면 한쪽만
 * 고쳐지는 날이 온다.
 */
export async function getFieldworkOrgName(orgId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: fieldworkOrgs.name })
    .from(fieldworkOrgs)
    .where(eq(fieldworkOrgs.id, orgId));
  return row?.name ?? null;
}
