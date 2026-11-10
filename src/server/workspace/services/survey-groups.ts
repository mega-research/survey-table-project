import {
  type SQL,
  type SQLWrapper,
  and,
  asc,
  eq,
  exists,
  ilike,
  inArray,
  isNull,
  ne,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import { type AnyPgColumn, alias } from 'drizzle-orm/pg-core';
import 'server-only';

import { type DbTransaction, db } from '@/db';
import { surveyGroups, surveys, teams } from '@/db/schema';
import { logger } from '@/lib/logger';
import { escapeLikePattern } from '@/lib/operations/filter-shared';
import { isUniqueViolation, retryOnTxConflict } from '@/lib/pg-error';
import {
  leadsParticipantTeam,
  participatesInSurvey,
} from '@/server/read-models/survey-structure';
import {
  type SurveyAccessUser,
  loadAccountAccessSubject,
  resolveSurveyCapabilities,
  surveyClosedColumn,
} from '@/server/survey-access';
import { scopeLeaderTeamIds } from '@/server/work-scope';
import { judgeSurveyGroupRelocation } from '@/utils/survey-group-tree';

import {
  type CollectSurveysIntoGroupInput,
  type CreateSurveyGroupInput,
  type CreateSurveyGroupOutput,
  DuplicateSurveyGroupNameError,
  type ListSurveyGroupsOutput,
  type ListUngroupedSurveysOutput,
  type MoveSurveyToGroupInput,
  type RelocateSurveyGroupInput,
  type RenameSurveyGroupInput,
  type ReorderSurveyGroupsInput,
  SURVEY_GROUP_MAX_DEPTH,
  SurveyAlreadyGroupedError,
  SurveyGroupDepthExceededError,
  SurveyGroupHasChildrenError,
  SurveyGroupNotFoundError,
  SurveyGroupRelocationCycleError,
  SurveyGroupRelocationTooDeepError,
  SurveyGroupTargetNotFoundError,
  SurveyTeamMismatchError,
} from '../domain/survey-groups';
import { TeamNotFoundError, type WorkspaceActionOutput } from '../domain/teams';

const OK: WorkspaceActionOutput = { success: true };

/**
 * 팀의 그룹 목록 + 설문 수 (.pen FLOW 2-1 · 3단계 중첩).
 *
 * 내 팀 그룹과 협업 그룹(타 팀)을 이어 붙인 **평평한 목록**이다 — 트리는 화면이 묶는다.
 * 내 팀 그룹의 가시성·건수는 `listOwnTeamGroups`, 협업 그룹은 `listCollaboratingGroups` 가 정한다.
 * 두 쪽 모두 보이는 조건이 설문 목록 조회(`buildSurveyScopeFilter`)와 **같은 술어 조각**이다 —
 * 사본을 두면 「그룹은 보이는데 안이 비었거나, 설문은 보이는데 폴더가 없는」 상태가 된다.
 */
export async function listSurveyGroups(
  user: SurveyAccessUser,
  teamId: string,
): Promise<ListSurveyGroupsOutput> {
  const subject = await loadAccountAccessSubject(user);
  // **팀 미배치는 초대 설문을 포함해 전부 차단이다**(판정 코어의 3번 분기). 관문이 이 표면에서
  // 빠졌으므로(위 procedure 주석) 그 차단을 여기서 대신 진다 — 없으면 마지막 팀에서 제외된
  // 사람이 참여 행만으로 협업 그룹 이름·소유 팀 이름·설문 수를 계속 읽는다. 설문 목록은
  // work-scope 가 'none' 으로 접어 이미 닫혀 있는데 이 문만 열려 있었다.
  if (!subject.isSuperadmin && subject.activeTeamIds.length === 0) return [];

  const isTeamMember = subject.isSuperadmin || subject.activeTeamIds.includes(teamId);
  const seesInviteOnly = subject.isSuperadmin || subject.leaderTeamIds.includes(teamId);
  // 목록(buildSurveyScopeFilter)과 같은 전파 팀 — 슈퍼어드민은 지목한 팀의 팀장처럼 본다.
  const leaderTeamIds = scopeLeaderTeamIds(subject, teamId);
  // 내 팀 그룹의 카운트도 **설문 목록과 같은 술어**를 봐야 한다. 팀 공개·내 소유만 세면,
  // 같은 팀의 남의 `invite_only` 설문에 **초대받아** 볼 수 있는 사람에게 그 설문만 담긴
  // 그룹이 사라진다 — 목록에는 설문이 보이는데 폴더는 없는 상태다. 협업 조회는 내 범위 팀을
  // 빼므로 이걸 복구해 주지 못한다.
  const visibleHere = seesInviteOnly
    ? undefined
    : or(
        eq(surveys.visibility, 'team'),
        eq(surveys.ownerUserId, subject.userId),
        participatesInSurvey(subject.userId),
        leaderTeamIds.length > 0 ? leadsParticipantTeam(leaderTeamIds) : undefined,
      );

  const own = isTeamMember ? await listOwnTeamGroups(teamId, visibleHere) : [];

  return [...own, ...(await listCollaboratingGroups(subject.userId, leaderTeamIds, teamId))];
}

/**
 * 내 팀 그룹 — 가시성과 건수가 **하위 그룹까지** 본다(3단계 중첩 티켓 02).
 *
 * 그룹마다 「그 그룹과 그 아래 전체」에 담긴 설문을 두 번 센다 — 요청자가 **볼 수 있는** 수와
 * 가시성과 무관한 **담긴** 수. 규칙은 이 둘에서 나온다.
 *
 * - **건수**는 볼 수 있는 수다. `invite_only` 는 소유 팀 팀원에게만 숨기는데(스펙 §3) 그것까지
 *   세면 사이드바는 「임원 조사 3」이라 하고 그룹 화면에는 카드가 1장만 나온다 — 뺄셈 한 번으로
 *   "내게 숨겨진 설문이 2건 있다" 가 드러난다.
 * - **담긴 설문이 있는데 볼 수 있는 것이 하나도 없으면 「숨는 그룹」이다.** 건수를 0 으로 만드는
 *   것으로는 부족하다 — 폴더가 목록에 서 있으면 이름 자체가 정보이고(「임원 조사」), 「0건인데
 *   왜 있지」로 숨겨진 설문의 존재가 드러난다. 그래서 **행이 나오지 않는다**. 협업 그룹이 inner
 *   join 으로 같은 규칙을 얻는 것과 짝이다.
 * - **아래 전체가 빈 그룹은 보인다.** 감출 설문이 없고, 폴더를 먼저 만들고 나중에 담는 동선이라
 *   안 보이면 방금 만든 폴더가 즉시 사라진다. 담긴 수에 가시성 조건을 **일부러 걸지 않는** 이유가
 *   이것이다 — 걸면 볼 수 있는 수와 같아져 빈 그룹과 「전부 숨은 그룹」을 구별하지 못한다.
 * - **위쪽 그룹 중 하나라도 숨으면 함께 숨는다.** 하위 어디든 볼 수 있는 설문이 있으면 위쪽은
 *   전부 보이므로, 이 규칙이 더 숨기는 것은 숨는 그룹 밑의 **빈 가지**뿐이다. 그 줄이 남으면
 *   위가 없는 줄이 뿌리처럼 떠오르고, 「이 위에 내가 못 보는 그룹이 있다」가 상위 그룹 id 로
 *   드러난다. 그래서 내 팀 줄의 상위 그룹 id 는 언제나 목록 안의 줄을 가리키고, 목록 안에서 센
 *   깊이가 실제 깊이와 같다.
 *
 * 깊이가 3으로 묶여 있어(0166) 재귀 조회 없이 **자기 조인**으로 「아래 전체」를 편다
 * (`isWithinGroupSubtree`). 팀당 그룹은 수십 건이다.
 *
 * 설문 조인에 `surveys.teamId = surveyGroups.teamId` 도 함께 건다. 그룹은 팀 소유물이라 팀이 다른
 * 설문이 그룹에 남아 있으면 그건 이미 깨진 상태고(팀을 옮기는 흐름이 surveyGroupId 를 안 내린
 * 경우), 그 행을 세어 보여주면 깨진 상태를 정상처럼 보이게 한다.
 */
async function listOwnTeamGroups(
  teamId: string,
  visibleHere: SQL | undefined,
): Promise<ListSurveyGroupsOutput> {
  // 설문을 직접 담은 그룹 — 바깥 그룹의 「아래 전체」에 드는 줄마다 한 번씩 붙는다.
  const holder = alias(surveyGroups, 'holder_group');
  const heldCount = sql<number>`count(${surveys.id})`;
  const visibleCount = visibleHere
    ? sql<number>`count(${surveys.id}) filter (where ${visibleHere})`
    : heldCount;

  const stats = db.$with('group_stats').as(
    db
      .select({
        groupId: surveyGroups.id,
        visibleCount: sql<number>`(${visibleCount})::int`.as('visible_count'),
        hidesSurveys: sql<boolean>`(${heldCount} > 0 and ${visibleCount} = 0)`.as('hides_surveys'),
      })
      .from(surveyGroups)
      .innerJoin(
        holder,
        and(eq(holder.teamId, surveyGroups.teamId), isWithinGroupSubtree(holder, surveyGroups.id)),
      )
      .leftJoin(
        surveys,
        and(
          eq(surveys.surveyGroupId, holder.id),
          eq(surveys.teamId, surveyGroups.teamId),
          isNull(surveys.deletedAt),
        ),
      )
      .where(eq(surveyGroups.teamId, teamId))
      .groupBy(surveyGroups.id),
  );
  // 같은 집계를 「숨는 그룹」 판정용으로 한 번 더 읽는다 — 이름을 달리 붙여야 바깥 줄과 견준다.
  const hiding = db
    .select({ groupId: stats.groupId, hidesSurveys: stats.hidesSurveys })
    .from(stats)
    .as('hiding_group');

  return (
    db
      .with(stats)
      .select({
        id: surveyGroups.id,
        name: surveyGroups.name,
        order: surveyGroups.order,
        parentGroupId: surveyGroups.parentGroupId,
        surveyCount: stats.visibleCount,
        foreignTeamName: sql<string | null>`null`,
      })
      .from(surveyGroups)
      // **해산된 팀의 그룹은 없는 것으로 본다**(티켓 13). 관문이 목록에서 빠졌으므로
      // (조회 조건이 좁힌다) 이 조인이 그 계약을 대신 진다 — 없으면 슈퍼어드민이 archived
      // 팀 그룹을 계속 본다(멤버십 축과 달리 슈퍼어드민은 소속 검사를 지나지 않는다).
      .innerJoin(teams, and(eq(teams.id, surveyGroups.teamId), eq(teams.status, 'active')))
      .innerJoin(stats, eq(stats.groupId, surveyGroups.id))
      .where(
        and(
          eq(surveyGroups.teamId, teamId),
          // 자기 자신이든 위쪽 그룹이든, 숨는 그룹의 「아래 전체」에 들면 나오지 않는다.
          notExists(
            db
              .select({ one: sql`1` })
              .from(hiding)
              .where(and(hiding.hidesSurveys, isWithinGroupSubtree(surveyGroups, hiding.groupId))),
          ),
        ),
      )
      .orderBy(asc(surveyGroups.order), asc(surveyGroups.name))
  );
}

/**
 * `node` 그룹이 `rootId` 그룹 자신이거나 그 아래에 있는가.
 *
 * 깊이가 3이라 「아래」는 두 단계뿐이다 — 자기 · 바로 밑 · 그 밑. 마지막 한 칸만 가운데 그룹을
 * 한 번 더 읽는다. 깊이 상한(`SURVEY_GROUP_MAX_DEPTH`)이 늘면 이 술어가 한 단계를 놓친다.
 */
function isWithinGroupSubtree(
  node: { id: AnyPgColumn; parentGroupId: AnyPgColumn },
  rootId: SQLWrapper,
): SQL {
  const middle = alias(surveyGroups, 'middle_group');
  return or(
    eq(node.id, rootId),
    eq(node.parentGroupId, rootId),
    exists(
      db
        .select({ one: sql`1` })
        .from(middle)
        .where(and(eq(middle.id, node.parentGroupId), eq(middle.parentGroupId, rootId))),
    ),
  )!;
}

/**
 * 협업 그룹 — **내가 볼 수 있는 설문이 담긴 타 팀 그룹** (초대·팀장 전파).
 *
 * 규칙이 하나라는 것이 이 함수의 요점이다: 접근 가능한 설문이 담겼으면 보이고, 그 설문을
 * 빼면 사라진다. 그래서 `survey_groups` 에 「협업 그룹」 플래그를 두지 않는다 — 플래그를 두면
 * 담기와 별개로 그것을 관리하는 화면이 필요하고, 둘이 어긋나는 상태가 표현 가능해진다.
 *
 * 조인이 **inner** 인 것이 그 규칙을 강제한다. 접근 가능 설문이 0건인 그룹은 행 자체가 나오지
 * 않아, 「2026년」처럼 내가 초대받지 않은 설문만 담긴 폴더는 **이름조차 노출되지 않는다**.
 * 카운트 0으로 보여주면 뺄셈 한 번에 "내게 숨겨진 설문이 있다" 가 드러난다(위 listSurveyGroups
 * 주석이 같은 이유로 피해 둔 자리다).
 *
 * 보이는 조건은 목록 read-model 과 **같은 조각**을 쓴다(`participatesInSurvey`·
 * `leadsParticipantTeam`). 사본을 두면 그룹 트리와 설문 목록이 갈려 「그룹은 보이는데 안이
 * 비었거나, 설문은 보이는데 폴더가 없는」 상태가 된다.
 *
 * **상위 그룹은 내지 않는다**(`parentGroupId` 는 언제나 null) — 설문 하나에 초대했을 뿐인 타 팀
 * 사람에게 그 팀의 정리 구조가 드러나면 안 된다. 그래서 협업 그룹은 몇 단계에 있든 한 줄이다.
 *
 * 내 범위 팀은 제외한다 — 그 팀 그룹은 위에서 이미 전부 나왔고(멤버라면), 멤버가 아니라면
 * 협업 조건으로 여기서 잡힌다. 그래서 `ne` 가 아니라 **멤버 여부에 따라** 갈라야 할 것 같지만,
 * 멤버가 아닌 팀의 teamId 가 범위로 들어오는 경로가 없다(work-scope 가 내 팀으로 접는다).
 */
async function listCollaboratingGroups(
  viewerId: string,
  leaderTeamIds: readonly string[],
  scopeTeamId: string,
): Promise<ListSurveyGroupsOutput> {
  const accessible =
    leaderTeamIds.length > 0
      ? or(participatesInSurvey(viewerId), leadsParticipantTeam(leaderTeamIds))!
      : participatesInSurvey(viewerId);

  return db
    .select({
      id: surveyGroups.id,
      name: surveyGroups.name,
      order: surveyGroups.order,
      parentGroupId: sql<string | null>`null`,
      surveyCount: sql<number>`count(${surveys.id})::int`,
      foreignTeamName: teams.name,
    })
    .from(surveyGroups)
    .innerJoin(teams, and(eq(teams.id, surveyGroups.teamId), eq(teams.status, 'active')))
    .innerJoin(
      surveys,
      and(
        eq(surveys.surveyGroupId, surveyGroups.id),
        eq(surveys.teamId, surveyGroups.teamId),
        isNull(surveys.deletedAt),
        accessible,
      ),
    )
    .where(ne(surveyGroups.teamId, scopeTeamId))
    .groupBy(surveyGroups.id, teams.name)
    .orderBy(asc(teams.name), asc(surveyGroups.order), asc(surveyGroups.name));
}

/** 이 팀이 아직 살아 있는가 — 해산된 팀에는 그룹 표면 전체가 닫힌다(티켓 13). */
export async function isActiveTeam(teamId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.status, 'active')))
    .limit(1);
  return row !== undefined;
}

/**
 * 그룹의 소유 팀 — groupId 만 받는 표면의 권한 판정용. 없으면 null.
 *
 * **해산된 팀의 그룹은 없는 것으로 본다**(티켓 13). 팀이 archived 가 되면 그 그룹은 아무도
 * 도달할 수 없는 잔여물이고(설문은 이미 전부 미분류로 떨어져 나갔다), 슈퍼어드민만 멤버십
 * 검사를 건너뛰어 이름 변경·삭제가 열려 있었다. 그룹 행 자체는 감사 계보로 남긴다
 * (0117 헤더) — 여기서 막는 것은 쓰기 경로다.
 */
export async function getSurveyGroupTeamId(groupId: string): Promise<string | null> {
  const [row] = await db
    .select({ teamId: surveyGroups.teamId })
    .from(surveyGroups)
    .innerJoin(teams, and(eq(teams.id, surveyGroups.teamId), eq(teams.status, 'active')))
    .where(eq(surveyGroups.id, groupId))
    .limit(1);
  return row?.teamId ?? null;
}

/**
 * 그룹 생성 — 새 그룹은 **그 부모의** 맨 뒤에 붙는다(상위 그룹이 없으면 최상위의 맨 뒤).
 *
 * order 를 0 으로 두면 이름순으로 아무 데나 끼어들어 보인다. 기존 최대값 +1 은 팀 키 아래서
 * 읽으므로 같은 값이 나지 않는다.
 *
 * 상위 그룹은 **잠금 아래서 다시** 본다(관문이 본 것은 별도 왕복이다) — 없는 그룹·다른 팀의
 * 그룹은 같은 사유로 접고, 3단계 그룹 밑이면 거부한다. 두 판정 모두 DB 가 한 번 더 막는다
 * (0166 의 복합 FK·CHECK): 서비스가 틀려도 4단계나 타 팀 부모는 생기지 않는다.
 */
export async function createSurveyGroup(
  actorUserId: string,
  input: CreateSurveyGroupInput,
): Promise<CreateSurveyGroupOutput> {
  return inGroupStructureTx(async (tx) => {
    await lockTeamGroupStructure(tx, input.teamId);
    const parent = await loadParentForNewGroup(tx, input.teamId, input.parentGroupId ?? null);

    const [tail] = await tx
      .select({ maxOrder: sql<number | null>`max(${surveyGroups.order})` })
      .from(surveyGroups)
      .where(and(eq(surveyGroups.teamId, input.teamId), isChildOf(parent?.id ?? null)));

    try {
      const [group] = await tx
        .insert(surveyGroups)
        .values({
          teamId: input.teamId,
          name: input.name,
          createdBy: actorUserId,
          order: (tail?.maxOrder ?? -1) + 1,
          parentGroupId: parent?.id ?? null,
          parentDepth: parent?.depth ?? null,
        })
        .returning({ id: surveyGroups.id });
      if (!group) throw new SurveyGroupNotFoundError();
      return { id: group.id };
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateSurveyGroupNameError();
      throw err;
    }
  });
}

/**
 * 이름 변경 — 팀 키를 잡고 그 팀이 아직 살아 있는지 다시 본다.
 *
 * 관문(procedure)이 이미 확인했지만 별도 왕복이라, 그 사이 해산이 커밋되면 archived 팀의
 * 그룹 이름이 바뀐다. 그 행은 감사 계보로 남기기로 한 것이다(티켓 13).
 *
 * 이름이 겹치는지는 **같은 상위 그룹 안에서만** 본다 — 판정은 DB 유일 인덱스가 한다.
 */
export async function renameSurveyGroup(
  input: RenameSurveyGroupInput,
): Promise<WorkspaceActionOutput> {
  return inGroupStructureTx(async (tx) => {
    await lockGroupStructureByGroup(tx, input.groupId);
    try {
      const [row] = await tx
        .update(surveyGroups)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(surveyGroups.id, input.groupId))
        .returning({ id: surveyGroups.id });
      if (!row) throw new SurveyGroupNotFoundError();
      return OK;
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateSurveyGroupNameError();
      throw err;
    }
  });
}

/**
 * 그룹 옮기기 — 그룹을 하위 그룹·담긴 설문째 다른 그룹 밑으로(`parentGroupId: null` 은 최상위로) 옮긴다.
 *
 * 쓰는 것은 **그 그룹 한 행**의 상위 칸 둘과 순서뿐이다. 하위 그룹의 깊이는 DB 가 따라 고치고
 * (0166 의 `survey_groups_parent_fk` ON UPDATE CASCADE), 설문은 그룹을 가리킬 뿐이라 손대지
 * 않는다 — 담긴 설문의 소속 그룹도 `updatedAt` 도 그대로다.
 *
 * 판정은 **팀 키 아래서 읽은 그 팀의 구조 전부**로 한다. 화면의 옮기기 창과 같은 순수 함수
 * (`judgeSurveyGroupRelocation`)를 쓰되, 화면은 요청자에게 보이는 그룹만 알고 여기는 전부를 안다.
 * 구조를 바꾸는 쓰기가 모두 같은 키를 잡으므로 읽은 구조가 낡지 않는다 — 두 사람이 서로의 하위로
 * 동시에 옮기거나 동시에 한 단씩 늘려도, 나중 요청은 먼저 끝난 결과를 보고 거부된다.
 *
 * - 다른 팀의 그룹·없는 그룹을 새 상위로 지목하면 같은 「없는 그룹」이다(구조를 그 팀으로 좁혀 읽는다).
 * - 자기 자신·자기 하위 밑, 3단계를 넘는 자리는 DB 도 막지만 그쪽은 CHECK 위반(500)이라 여기서
 *   먼저 알맞은 사유로 거부한다. DB 는 이 판정이 틀렸을 때의 마지막 방어선이다.
 * - **지금 있는 자리로 옮기는 요청은 아무것도 쓰지 않고 성공한다** — 맨 뒤로 다시 붙이지도 않는다.
 * - 옮겨 온 그룹은 새 부모의 맨 뒤에 붙는다. 그 자리에 같은 이름이 있으면 유일 인덱스가 막는다.
 */
export async function relocateSurveyGroup(
  input: RelocateSurveyGroupInput,
): Promise<WorkspaceActionOutput> {
  const moved = await inGroupStructureTx(async (tx) => {
    const group = await lockGroupStructureByGroup(tx, input.groupId);
    const structure = await tx
      .select({
        id: surveyGroups.id,
        parentGroupId: surveyGroups.parentGroupId,
        depth: surveyGroups.depth,
      })
      .from(surveyGroups)
      .where(eq(surveyGroups.teamId, group.teamId));

    const blocked = judgeSurveyGroupRelocation(
      structure,
      input.groupId,
      input.parentGroupId,
      SURVEY_GROUP_MAX_DEPTH,
    );
    if (blocked === 'current') return null;
    if (blocked === 'missing') throw new SurveyGroupNotFoundError();
    if (blocked === 'self' || blocked === 'descendant') throw new SurveyGroupRelocationCycleError();
    if (blocked === 'too_deep') throw new SurveyGroupRelocationTooDeepError();

    const parent = structure.find((row) => row.id === input.parentGroupId) ?? null;
    const [tail] = await tx
      .select({ maxOrder: sql<number | null>`max(${surveyGroups.order})` })
      .from(surveyGroups)
      .where(and(eq(surveyGroups.teamId, group.teamId), isChildOf(parent?.id ?? null)));

    try {
      await tx
        .update(surveyGroups)
        .set({
          parentGroupId: parent?.id ?? null,
          parentDepth: parent?.depth ?? null,
          order: (tail?.maxOrder ?? -1) + 1,
          updatedAt: new Date(),
        })
        .where(eq(surveyGroups.id, input.groupId));
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateSurveyGroupNameError();
      throw err;
    }
    return {
      teamId: group.teamId,
      movedSubgroups: countSubgroupsBelow(structure, input.groupId),
    };
  });

  // RPC 로그 한 줄에는 그룹 id 가 없다 — 어느 그룹이 하위 그룹 몇 개를 달고 어디로 갔는지는 이 줄이 남긴다.
  if (moved) {
    logger.info(
      {
        teamId: moved.teamId,
        groupId: input.groupId,
        parentGroupId: input.parentGroupId,
        movedSubgroups: moved.movedSubgroups,
      },
      '[survey-group] 그룹을 옮겼다',
    );
  }
  return OK;
}

/** 그 그룹 아래 전체의 하위 그룹 수 — 옮길 때 함께 따라간 그룹을 로그에 남기려고 센다. */
function countSubgroupsBelow(
  structure: readonly { id: string; parentGroupId: string | null }[],
  groupId: string,
): number {
  const below = new Set<string>();
  let frontier = [groupId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const row of structure) {
      if (row.parentGroupId === null || below.has(row.id) || row.id === groupId) continue;
      if (frontier.includes(row.parentGroupId)) {
        below.add(row.id);
        next.push(row.id);
      }
    }
    frontier = next;
  }
  return below.size;
}

/**
 * 정렬 — **한 부모의 형제만**, 화면이 준 순서대로 order 를 다시 매긴다.
 *
 * UPDATE 를 teamId 와 상위 그룹으로 함께 좁히는 것이 경계다: 배열에 타 팀 groupId 나 다른 부모
 * 밑의 groupId 가 섞여 들어와도 그 행에는 닿지 않는다(관문이 이미 요청자의 팀을 확인했으므로
 * 조용히 무시해도 안전하다). 순서 값은 「같은 부모 안에서의 표시 순서」라, 다른 부모의 형제까지
 * 한 배열로 매기면 그쪽 순서가 조용히 뒤섞인다.
 *
 * 팀 키 advisory lock 을 잡는 이유는 lost update 때문이 아니다(순서 값은 표시용이라 덮여도
 * 불변식이 안 깨진다) — **행 잠금 순서가 요청자마다 다르기 때문**이다. 그룹이 팀 공용이라
 * 두 팀원이 같은 목록을 동시에 드래그하는 것이 정상 동선인데, 한쪽은 [g1,g2] 다른 쪽은
 * [g2,g1] 로 UPDATE 하면 서로의 락을 기다려 40P01 데드락이 난다. 그 에러는 도메인 에러가
 * 아니라 500 으로 새어 나간다. 같은 팀의 정렬을 직렬화하면 순서 사이클 자체가 없어진다
 * (members 의 lockTeamMembers 와 같은 관례).
 */
export async function reorderSurveyGroups(
  input: ReorderSurveyGroupsInput,
): Promise<WorkspaceActionOutput> {
  await inGroupStructureTx(async (tx) => {
    // 관문과 이 쓰기 사이에 해산이 커밋될 수 있다 — 잠긴 값으로 다시 본다.
    await lockTeamGroupStructure(tx, input.teamId);
    const siblingsOnly = isChildOf(input.parentGroupId ?? null);
    for (const [index, groupId] of input.orderedGroupIds.entries()) {
      await tx
        .update(surveyGroups)
        .set({ order: index, updatedAt: new Date() })
        .where(
          and(eq(surveyGroups.id, groupId), eq(surveyGroups.teamId, input.teamId), siblingsOnly),
        );
    }
  });
  return OK;
}

/**
 * 그룹 삭제 — 소속 설문은 미분류로 돌아간다 (FK ON DELETE SET NULL).
 *
 * 설문·응답·공유 설정은 손대지 않는다(.pen FLOW 2-3 의 「그룹만 삭제되고 설문은 삭제되지
 * 않습니다」). 그래서 여기서 설문을 따로 UPDATE 하지 않는다 — DB 가 원자적으로 처리한다.
 *
 * **하위 그룹이 있는 그룹은 지우지 않는다.** 따라 지우면 클릭 한 번에 정리해 둔 가지가 통째로
 * 사라진다. DB 도 같은 것을 막는다(0166 의 `survey_groups_parent_fk` — 하위가 남아 있으면 거부).
 */
export async function removeSurveyGroup(groupId: string): Promise<WorkspaceActionOutput> {
  return inGroupStructureTx(async (tx) => {
    // 팀 키 → 팀 행 → 그룹 행 → (FK 가 건드리는) 설문 행. 해산은 팀 → 설문만 잡으므로 사이클이 없다.
    // **삭제야말로 되돌릴 수 없다.** 관문 확인 뒤 해산이 커밋된 사이에 이 삭제가 실행되면
    // 티켓 13 이 감사 계보로 남기기로 한 archived 팀의 그룹 행이 영구히 사라진다.
    await lockGroupStructureByGroup(tx, groupId);

    const [child] = await tx
      .select({ id: surveyGroups.id })
      .from(surveyGroups)
      .where(eq(surveyGroups.parentGroupId, groupId))
      .limit(1);
    if (child) throw new SurveyGroupHasChildrenError();

    const [row] = await tx
      .delete(surveyGroups)
      .where(eq(surveyGroups.id, groupId))
      .returning({ id: surveyGroups.id });
    if (!row) throw new SurveyGroupNotFoundError();
    return OK;
  });
}

/**
 * 「설문 담기」 후보 — 그 팀의 **미분류** 설문 중 **요청자가 볼 수 있는 것만** (.pen FLOW 2-2).
 *
 * 팀 소속이라고 팀의 모든 설문이 보이는 것은 아니다 — `invite_only` 는 소유 팀 팀원에게만
 * 숨긴다(스펙 §3). survey.view 없는 행을 "편집 권한 없음" 으로 그려 남겨두면 제목이 그대로
 * 새어 목록 화면이 숨긴 것을 이 패널이 보여준다. 그래서 **거르는 것이 먼저이고**
 * `canMove` 는 그다음이다.
 *
 * `canMove` 는 근사가 아니라 서버 판정 그대로다: 주체를 한 번 싣고
 * resolveSurveyCapabilities(순수)를 행마다 돌린다. 목록 화면의 canEditSurveyCard 처럼
 * 규칙을 두 벌 쓰면 "선택은 되는데 담기면 거부" 가 생긴다. 요구는 survey.edit +
 * surveyGroup.manage 둘 다다 — 참여자(티켓 18)는 편집권은 있어도 그 팀의 그룹 구조를 만질
 * 자격이 없다. 그 조합이 「볼 수는 있지만 담을 수는 없는」 행을 만든다.
 */
export async function listUngroupedSurveys(input: {
  user: SurveyAccessUser;
  teamId: string;
  query: string;
}): Promise<ListUngroupedSurveysOutput> {
  const rows = await db
    .select({
      id: surveys.id,
      title: surveys.title,
      updatedAt: surveys.updatedAt,
      teamId: surveys.teamId,
      visibility: surveys.visibility,
      ownerUserId: surveys.ownerUserId,
      assignmentStatus: surveys.assignmentStatus,
      // 링크 주체만 보는 축이지만 판정 입력의 모양이라 여기서도 싣는다 — 계정 분기는 읽지 않는다.
      isPaused: surveys.isPaused,
      isClosed: surveyClosedColumn,
    })
    .from(surveys)
    .where(
      and(
        eq(surveys.teamId, input.teamId),
        isNull(surveys.surveyGroupId),
        isNull(surveys.deletedAt),
        // `%`·`_` 를 그대로 넘기면 사용자가 친 「50%」가 와일드카드가 되어 검색이 넓어진다.
        input.query.length > 0
          ? ilike(surveys.title, `%${escapeLikePattern(input.query)}%`)
          : undefined,
      ),
    )
    .orderBy(asc(surveys.title));

  const subject = await loadAccountAccessSubject(input.user);
  return rows.flatMap((row) => {
    const caps = resolveSurveyCapabilities(subject, row, null);
    if (!caps.has('survey.view')) return [];
    return [
      {
        id: row.id,
        title: row.title,
        updatedAt: row.updatedAt,
        canMove: caps.has('survey.edit') && caps.has('surveyGroup.manage'),
      },
    ];
  });
}

/**
 * 일괄 담기 — 그룹 행과 대상 설문 행을 모두 잠근 뒤 **잠긴 값으로** 다시 판정한다.
 *
 * 관문이 본 teamId·surveyGroupId 는 판정 시점의 값이다. 그 사이에 다른 담기·단건 이동·팀
 * 해산·재배치가 끼어들면 UPDATE 는 옛 판정을 근거로 강행되어 "미분류만" 불변식과 팀 경계가
 * 함께 깨진다. 잠금 순서는 그룹 → 설문(그 안에서는 id 오름차순)으로 고정한다 —
 * moveSurveyToGroup 과 같은 순서라 두 함수 사이에도 데드락이 생기지 않는다.
 *
 * `updatedAt` 은 손대지 않는다 — 폴더에 넣는 일은 설문 내용을 고치는 일이 아니고, 건드리면
 * 「최신 수정순」 기본 정렬이 담기 한 번에 통째로 뒤집힌다.
 */
export async function collectSurveysIntoGroup(
  input: CollectSurveysIntoGroupInput,
): Promise<WorkspaceActionOutput> {
  return db.transaction(async (tx) => {
    const group = await lockGroup(tx, input.groupId);

    const rows = await tx
      .select({ id: surveys.id, surveyGroupId: surveys.surveyGroupId, teamId: surveys.teamId })
      .from(surveys)
      .where(and(inArray(surveys.id, input.surveyIds), isNull(surveys.deletedAt)))
      // 설문들 **사이의** 잠금 순서도 고정한다. ORDER BY 가 없으면 실행 계획이 순서를
      // 정해(건수에 따라 인덱스 스캔 ↔ 비트맵 스캔) 겹치는 집합을 동시에 담는 두 요청의
      // 잠금 순서가 갈리고, 그때 데드락이 성립한다.
      .orderBy(asc(surveys.id))
      .for('update');
    if (rows.length !== input.surveyIds.length) throw new SurveyGroupTargetNotFoundError();

    for (const row of rows) {
      if (row.teamId !== group.teamId) throw new SurveyTeamMismatchError();
      if (row.surveyGroupId !== null) throw new SurveyAlreadyGroupedError();
    }

    await tx
      .update(surveys)
      .set({ surveyGroupId: input.groupId })
      .where(inArray(surveys.id, input.surveyIds));
    return OK;
  });
}

/**
 * 단건 이동 (카드 케밥) — `groupId: null` 은 미분류로 이동(그룹에서 빼기).
 *
 * 그룹을 지정한 경우에만 팀 일치를 본다. 빼기는 목적지가 없으므로 설문 존재 확인이 전부다.
 * 잠금이 필요한 이유는 담기와 같다 — 관문 이후 팀이 바뀌면 팀 경계를 넘는 편입이 된다.
 */
export async function moveSurveyToGroup(
  input: MoveSurveyToGroupInput,
): Promise<WorkspaceActionOutput> {
  return db.transaction(async (tx) => {
    const groupTeamId = input.groupId === null ? null : (await lockGroup(tx, input.groupId)).teamId;

    const [survey] = await tx
      .select({ id: surveys.id, teamId: surveys.teamId })
      .from(surveys)
      .where(and(eq(surveys.id, input.surveyId), isNull(surveys.deletedAt)))
      .for('update');
    if (!survey) throw new SurveyGroupTargetNotFoundError();
    if (input.groupId !== null && survey.teamId !== groupTeamId)
      throw new SurveyTeamMismatchError();

    await tx
      .update(surveys)
      .set({ surveyGroupId: input.groupId })
      .where(eq(surveys.id, input.surveyId));
    return OK;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 구조 쓰기의 한 줄 세우기 (3단계 중첩, 0166)
// ─────────────────────────────────────────────────────────────────────────────
//
// 그룹 구조를 바꾸는 쓰기(만들기·이름 바꾸기·순서 바꾸기·옮기기·지우기)는 전부
// **한 트랜잭션에서 팀 키 advisory lock 을 먼저 잡는다.** 깊이·이름 겹침·「하위 그룹이 있는가」의
// 판정이 모두 「읽고 나서 쓰기」라, 같은 팀의 구조 쓰기가 겹치면 서로가 읽은 것이 낡는다.
//
// 잠금 순서는 하나다 — **팀 키 → 팀 행(FOR SHARE) → 그룹 행 → 설문 행.** 설문 행을 잠그는
// 담기·이동은 팀 키를 잡지 않고 그룹 행 → 설문 행으로 가므로 방향이 같다. 팀 키를 그룹 행이나
// 설문 행 **뒤에** 잡는 경로를 만들지 말 것.

/** 구조 쓰기 트랜잭션 — 교착(40P01)·직렬화 실패(40001)면 처음부터 다시 돈다. */
function inGroupStructureTx<T>(run: (tx: DbTransaction) => Promise<T>): Promise<T> {
  return retryOnTxConflict(() => db.transaction(run));
}

/**
 * 그 팀의 그룹 구조를 잠근다 — 팀 키 advisory lock + 팀이 아직 살아 있는지.
 *
 * 구조 쓰기의 **첫 줄**이어야 한다. 트랜잭션 잠금이라 커밋·롤백에서 풀린다.
 */
async function lockTeamGroupStructure(tx: DbTransaction, teamId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('survey-groups-' || ${teamId}))`);
  await requireActiveTeamLocked(tx, teamId);
}

/**
 * `groupId` 만 받는 구조 쓰기의 첫 줄 — 그룹의 팀으로 구조를 잠그고 그 그룹 행을 잠가 돌려준다.
 *
 * 팀 키를 고르려면 그룹의 팀을 먼저 알아야 해서 **잠금 없이** 한 번 읽는다. 그룹의 팀은 바뀌지
 * 않으므로 그 값으로 고른 키는 틀리지 않는다. 기다리는 사이 그룹이 지워졌으면 뒤의 행 잠금이
 * 「없는 그룹」으로 답한다.
 */
async function lockGroupStructureByGroup(tx: DbTransaction, groupId: string): Promise<LockedGroup> {
  const [found] = await tx
    .select({ teamId: surveyGroups.teamId })
    .from(surveyGroups)
    .where(eq(surveyGroups.id, groupId));
  if (!found) throw new SurveyGroupNotFoundError();
  await lockTeamGroupStructure(tx, found.teamId);
  return lockGroup(tx, groupId);
}

/** 「이 부모의 하위 그룹인가」 — 부모가 null 이면 최상위끼리. */
function isChildOf(parentGroupId: string | null): SQL {
  return parentGroupId === null
    ? isNull(surveyGroups.parentGroupId)
    : eq(surveyGroups.parentGroupId, parentGroupId);
}

/**
 * 새 그룹의 상위 그룹을 읽어 「그 밑에 만들 수 있는가」를 본다. 최상위면 null.
 *
 * 팀 키 아래서 부르므로 읽은 깊이가 낡지 않는다(깊이를 바꾸는 쓰기는 전부 같은 키를 잡는다).
 * 다른 팀의 그룹은 없는 그룹과 같은 사유로 접는다 — 갈리면 id 로 타 팀 그룹의 존재가 확인된다.
 */
async function loadParentForNewGroup(
  tx: DbTransaction,
  teamId: string,
  parentGroupId: string | null,
): Promise<{ id: string; depth: number } | null> {
  if (parentGroupId === null) return null;
  const [parent] = await tx
    .select({ id: surveyGroups.id, teamId: surveyGroups.teamId, depth: surveyGroups.depth })
    .from(surveyGroups)
    .where(eq(surveyGroups.id, parentGroupId));
  if (!parent || parent.teamId !== teamId) throw new SurveyGroupNotFoundError();
  if (parent.depth >= SURVEY_GROUP_MAX_DEPTH) throw new SurveyGroupDepthExceededError();
  return { id: parent.id, depth: parent.depth };
}

/**
 * 이 팀이 아직 살아 있는지 **잠긴 값으로** 확인한다 (Codex 2차 리뷰).
 *
 * procedure 관문(assertSurveyGroupManage)도 같은 것을 묻지만 그건 별도 왕복이라, 확인과
 * 쓰기 사이에 해산이 커밋되면 archived 팀의 그룹 행이 그대로 수정·삭제된다. 티켓 13 이
 * 그 행을 **감사 계보로 보존**하기로 한 이상(0117 헤더) 그 창을 닫아야 한다.
 *
 * `FOR SHARE` 인 이유는 해산의 `FOR NO KEY UPDATE`(teams UPDATE)와 **충돌**하기 때문이다.
 * 해산이 팀 행을 먼저 잠그므로(dissolveTeam), 해산 중이면 여기서 대기하다 archived 를 보고
 * 거부된다. 새 설문 귀속(resolveNewSurveyOwnership)·설문 배치(assignSurveys)가 쓰는 것과
 * 같은 잠금이다 — 「해산된 팀에는 아무것도 새로 붙지 않는다」를 지키는 자리가 하나의 방식이어야 한다.
 */
async function requireActiveTeamLocked(tx: DbTransaction, teamId: string): Promise<void> {
  const [team] = await tx
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.status, 'active')))
    .for('share');
  if (!team) throw new TeamNotFoundError();
}

/** 잠근 그룹 행에서 읽은 구조 칸 — 잠금 아래의 값이라 판정에 그대로 쓴다. */
interface LockedGroup {
  teamId: string;
  /** 상위 그룹 (최상위면 null). */
  parentGroupId: string | null;
  /** 깊이 (1 = 최상위). */
  depth: number;
}

/** 그룹 행을 잠그고 소유 팀·구조 칸을 돌려준다 — 담기·이동이 공유하는 첫 단계(잠금 순서 고정). */
async function lockGroup(tx: DbTransaction, groupId: string): Promise<LockedGroup> {
  const [group] = await tx
    .select({
      teamId: surveyGroups.teamId,
      parentGroupId: surveyGroups.parentGroupId,
      depth: surveyGroups.depth,
    })
    .from(surveyGroups)
    .where(eq(surveyGroups.id, groupId))
    .for('update');
  if (!group) throw new SurveyGroupNotFoundError();
  return group;
}
