import {
  type SQL,
  and,
  asc,
  eq,
  exists,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import 'server-only';

import { type DbTransaction, db } from '@/db';
import { surveyGroups, surveys, teams } from '@/db/schema';
import { escapeLikePattern } from '@/lib/operations/filter-shared';
import { isUniqueViolation } from '@/lib/pg-error';
import {
  leadsParticipantTeam,
  participatesInSurvey,
} from '@/server/read-models/survey-structure';
import {
  type SurveyAccessUser,
  loadAccessSubject,
  resolveSurveyCapabilities,
} from '@/server/survey-access';

import {
  type CollectSurveysIntoGroupInput,
  type CreateSurveyGroupInput,
  type CreateSurveyGroupOutput,
  DuplicateSurveyGroupNameError,
  type ListSurveyGroupsOutput,
  type ListUngroupedSurveysOutput,
  type MoveSurveyToGroupInput,
  type RenameSurveyGroupInput,
  type ReorderSurveyGroupsInput,
  SurveyAlreadyGroupedError,
  SurveyGroupNotFoundError,
  SurveyGroupTargetNotFoundError,
  SurveyTeamMismatchError,
} from '../domain/survey-groups';
import { TeamNotFoundError, type WorkspaceActionOutput } from '../domain/teams';

const OK: WorkspaceActionOutput = { success: true };

/**
 * 팀의 그룹 목록 + 소속 설문 수 (.pen FLOW 2-1).
 *
 * 세는 것은 **요청자가 볼 수 있는 설문**이다. `invite_only` 는 소유 팀 팀원에게만 숨기는데
 * (스펙 §3) 카운트가 그것까지 세면 사이드바는 「임원 조사 3」이라 하고 그룹 화면에는 카드가
 * 1장만 나온다 — 뺄셈 한 번으로 "내게 숨겨진 설문이 2건 있다" 가 드러난다. 그래서 조인 조건이
 * 목록 조회(`buildSurveyScopeFilter` 의 seesInviteOnly)와 같은 술어를 쓴다.
 *
 * **카운트를 0 으로 만드는 것으로는 부족하다** — 폴더가 목록에 서 있으면 이름 자체가 정보이고
 * (「임원 조사」), 「0건인데 왜 있지」로 숨겨진 설문의 존재가 드러난다. 그래서 담긴 설문을
 * 하나도 볼 수 없는 그룹은 **행이 나오지 않는다**(having). 협업 그룹이 inner join 으로 같은
 * 규칙을 얻는 것과 짝이다.
 *
 * **빈 그룹은 예외다.** 감출 설문이 없고, 「그룹 관리」에서 폴더를 먼저 만들고 나중에 담는
 * 동선이라 안 보이면 방금 만든 폴더가 즉시 사라진다. 그래서 조건이 「보이는 설문이 있거나,
 * 담긴 설문이 아예 없다」 둘이다.
 *
 * 조인에 `surveys.teamId = surveyGroups.teamId` 도 함께 건다. 그룹은 팀 소유물이라 팀이 다른
 * 설문이 그룹에 남아 있으면 그건 이미 깨진 상태고(팀을 옮기는 흐름이 surveyGroupId 를 안 내린
 * 경우), 그 행을 세어 보여주면 깨진 상태를 정상처럼 보이게 한다.
 */
export async function listSurveyGroups(
  user: SurveyAccessUser,
  teamId: string,
): Promise<ListSurveyGroupsOutput> {
  const subject = await loadAccessSubject(user);
  // **팀 미배치는 초대 설문을 포함해 전부 차단이다**(판정 코어의 3번 분기). 관문이 이 표면에서
  // 빠졌으므로(위 procedure 주석) 그 차단을 여기서 대신 진다 — 없으면 마지막 팀에서 제외된
  // 사람이 참여 행만으로 협업 그룹 이름·소유 팀 이름·설문 수를 계속 읽는다. 설문 목록은
  // work-scope 가 'none' 으로 접어 이미 닫혀 있는데 이 문만 열려 있었다.
  if (!subject.isSuperadmin && subject.activeTeamIds.length === 0) return [];

  const isTeamMember = subject.isSuperadmin || subject.activeTeamIds.includes(teamId);
  const seesInviteOnly = subject.isSuperadmin || subject.leaderTeamIds.includes(teamId);
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
        subject.leaderTeamIds.length > 0
          ? leadsParticipantTeam(subject.leaderTeamIds)
          : undefined,
      );

  const own = isTeamMember
    ? await db
        .select({
          id: surveyGroups.id,
          name: surveyGroups.name,
          order: surveyGroups.order,
          surveyCount: sql<number>`count(${surveys.id})::int`,
          foreignTeamName: sql<string | null>`null`,
        })
        .from(surveyGroups)
        // **해산된 팀의 그룹은 없는 것으로 본다**(티켓 13). 관문이 목록에서 빠졌으므로
        // (조회 조건이 좁힌다) 이 조인이 그 계약을 대신 진다 — 없으면 슈퍼어드민이 archived
        // 팀 그룹을 계속 본다(멤버십 축과 달리 슈퍼어드민은 소속 검사를 지나지 않는다).
        .innerJoin(teams, and(eq(teams.id, surveyGroups.teamId), eq(teams.status, 'active')))
        .leftJoin(
          surveys,
          and(
            eq(surveys.surveyGroupId, surveyGroups.id),
            eq(surveys.teamId, surveyGroups.teamId),
            isNull(surveys.deletedAt),
            visibleHere,
          ),
        )
        .where(eq(surveyGroups.teamId, teamId))
        .groupBy(surveyGroups.id)
        .having(or(sql`count(${surveys.id}) > 0`, sql`not ${groupHoldsAnySurvey()}`))
        .orderBy(asc(surveyGroups.order), asc(surveyGroups.name))
    : [];

  return [...own, ...(await listCollaboratingGroups(subject, teamId))];
}

/**
 * 이 그룹에 (내가 볼 수 있는지와 무관하게) 설문이 담겨 있는가 — 빈 그룹만 가려내는 술어.
 *
 * 가시성 조건을 **일부러 걸지 않는다**. 이 값이 묻는 것은 「감출 것이 있는가」이고, 조건을
 * 걸면 바깥 카운트와 같아져 빈 그룹과 「전부 숨은 그룹」을 구별하지 못한다.
 */
function groupHoldsAnySurvey(): SQL<boolean> {
  const held = alias(surveys, 'group_survey');
  return sql<boolean>`${exists(
    db
      .select({ one: sql`1` })
      .from(held)
      .where(
        and(
          eq(held.surveyGroupId, surveyGroups.id),
          eq(held.teamId, surveyGroups.teamId),
          isNull(held.deletedAt),
        ),
      ),
  )}`;
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
 * 내 범위 팀은 제외한다 — 그 팀 그룹은 위에서 이미 전부 나왔고(멤버라면), 멤버가 아니라면
 * 협업 조건으로 여기서 잡힌다. 그래서 `ne` 가 아니라 **멤버 여부에 따라** 갈라야 할 것 같지만,
 * 멤버가 아닌 팀의 teamId 가 범위로 들어오는 경로가 없다(work-scope 가 내 팀으로 접는다).
 */
async function listCollaboratingGroups(
  subject: Awaited<ReturnType<typeof loadAccessSubject>>,
  scopeTeamId: string,
): Promise<ListSurveyGroupsOutput> {
  const accessible =
    subject.leaderTeamIds.length > 0
      ? or(
          participatesInSurvey(subject.userId),
          leadsParticipantTeam(subject.leaderTeamIds),
        )!
      : participatesInSurvey(subject.userId);

  return db
    .select({
      id: surveyGroups.id,
      name: surveyGroups.name,
      order: surveyGroups.order,
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
 * 그룹 생성 — 새 그룹은 목록 맨 뒤에 붙는다.
 *
 * order 를 0 으로 두면 이름순으로 아무 데나 끼어들어 보인다. 기존 최대값 +1 은 동시 생성에서
 * 같은 값이 날 수 있지만 정렬 순서는 불변식이 아니라 표시 순서라 그걸로 깨지는 것이 없다
 * (이름 2차 정렬이 받아준다).
 */
export async function createSurveyGroup(
  actorUserId: string,
  input: CreateSurveyGroupInput,
): Promise<CreateSurveyGroupOutput> {
  return db.transaction(async (tx) => {
    await requireActiveTeamLocked(tx, input.teamId);

    const [tail] = await tx
      .select({ maxOrder: sql<number | null>`max(${surveyGroups.order})` })
      .from(surveyGroups)
      .where(eq(surveyGroups.teamId, input.teamId));

    try {
      const [group] = await tx
        .insert(surveyGroups)
        .values({
          teamId: input.teamId,
          name: input.name,
          createdBy: actorUserId,
          order: (tail?.maxOrder ?? -1) + 1,
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
 * 이름 변경 — 그룹 행을 잠그고 그 팀이 아직 살아 있는지 다시 본다.
 *
 * 관문(procedure)이 이미 확인했지만 별도 왕복이라, 그 사이 해산이 커밋되면 archived 팀의
 * 그룹 이름이 바뀐다. 그 행은 감사 계보로 남기기로 한 것이다(티켓 13).
 */
export async function renameSurveyGroup(
  input: RenameSurveyGroupInput,
): Promise<WorkspaceActionOutput> {
  return db.transaction(async (tx) => {
    const { teamId } = await lockGroup(tx, input.groupId);
    await requireActiveTeamLocked(tx, teamId);
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
 * 정렬 — 화면이 준 순서대로 order 를 0..n-1 로 다시 매긴다.
 *
 * UPDATE 를 teamId 로도 좁히는 것이 팀 경계다: 배열에 타 팀 groupId 가 섞여 들어와도
 * 그 행에는 닿지 않는다(관문이 이미 요청자의 팀을 확인했으므로 조용히 무시해도 안전하다).
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
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('survey-groups-' || ${input.teamId}))`,
    );
    // 관문과 이 쓰기 사이에 해산이 커밋될 수 있다 — 잠긴 값으로 다시 본다.
    await requireActiveTeamLocked(tx, input.teamId);
    for (const [index, groupId] of input.orderedGroupIds.entries()) {
      await tx
        .update(surveyGroups)
        .set({ order: index, updatedAt: new Date() })
        .where(and(eq(surveyGroups.id, groupId), eq(surveyGroups.teamId, input.teamId)));
    }
  });
  return OK;
}

/**
 * 그룹 삭제 — 소속 설문은 미분류로 돌아간다 (FK ON DELETE SET NULL).
 *
 * 설문·응답·공유 설정은 손대지 않는다(.pen FLOW 2-3 의 「그룹만 삭제되고 설문은 삭제되지
 * 않습니다」). 그래서 여기서 설문을 따로 UPDATE 하지 않는다 — DB 가 원자적으로 처리한다.
 */
export async function removeSurveyGroup(groupId: string): Promise<WorkspaceActionOutput> {
  return db.transaction(async (tx) => {
    // 그룹 행 → 팀 행 순으로 잠근다(담기와 같은 방향). 해산은 팀 → 설문만 잡으므로 사이클이 없다.
    const { teamId } = await lockGroup(tx, groupId);
    // **삭제야말로 되돌릴 수 없다.** 관문 확인 뒤 해산이 커밋된 사이에 이 삭제가 실행되면
    // 티켓 13 이 감사 계보로 남기기로 한 archived 팀의 그룹 행이 영구히 사라진다.
    await requireActiveTeamLocked(tx, teamId);

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

  const subject = await loadAccessSubject(input.user);
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

/** 그룹 행을 잠그고 소유 팀을 돌려준다 — 담기·이동이 공유하는 첫 단계(잠금 순서 고정). */
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

async function lockGroup(tx: DbTransaction, groupId: string): Promise<{ teamId: string }> {
  const [group] = await tx
    .select({ id: surveyGroups.id, teamId: surveyGroups.teamId })
    .from(surveyGroups)
    .where(eq(surveyGroups.id, groupId))
    .for('update');
  if (!group) throw new SurveyGroupNotFoundError();
  return { teamId: group.teamId };
}
