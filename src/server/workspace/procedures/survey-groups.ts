import { ORPCError } from '@orpc/server';

import { authed } from '@/server/orpc';
import { getActiveTeamMemberships } from '@/server/read-models/team-memberships';
import { assertSurveyCapabilityBatchRpc } from '@/server/rpc-survey-access';

import {
  CollectSurveysIntoGroupInput,
  CreateSurveyGroupInput,
  CreateSurveyGroupOutput,
  DuplicateSurveyGroupNameError,
  ListSurveyGroupsInput,
  ListSurveyGroupsOutput,
  ListUngroupedSurveysInput,
  ListUngroupedSurveysOutput,
  MoveSurveyToGroupInput,
  RenameSurveyGroupInput,
  ReorderSurveyGroupsInput,
  SurveyAlreadyGroupedError,
  SurveyGroupIdInput,
  SurveyGroupNotFoundError,
  SurveyGroupTargetNotFoundError,
  SurveyTeamMismatchError,
} from '../domain/survey-groups';
import { WorkspaceActionOutput } from '../domain/teams';
import * as svc from '../services/survey-groups';
import { toWorkspaceRpcError } from './teams';

/**
 * 설문 그룹 procedure (역할 모델 v2 티켓 12, .pen FLOW 2).
 *
 * 관문이 두 갈래인 것이 이 표면의 전부다.
 *
 * - **그룹 구조**(생성·이름 변경·정렬·삭제·목록)는 팀 공용이다 — 슈퍼어드민 또는 그 팀의
 *   active 멤버면 팀장·팀원을 가리지 않는다. 그룹은 접근 권한이 아니라 정리용 묶음이라
 *   팀장 전용으로 좁힐 근거가 없다(스펙 §5 「팀 공용 그룹 관리」).
 * - **설문을 넣고 빼는 것**은 그 설문의 `survey.edit` + `surveyGroup.manage` 를 둘 다
 *   요구한다. survey.edit 만 보면 참여자(티켓 18)가 남의 팀 폴더 구조를 재배치할 수 있고,
 *   surveyGroup.manage 만 보면 팀원이 못 고치는 설문을 옮길 수 있다.
 *
 * capability 요구를 설문 쪽에 걸어두면 "요청자가 그 설문의 팀 사람인가" 를 따로 물을 필요가
 * 없다 — surveyGroup.manage 를 주는 경로(소유자·팀장·팀원·슈퍼어드민)가 곧 그 답이다.
 */

/** 설문을 그룹에 넣고 빼는 데 필요한 capability 짝. */
const SURVEY_MOVE_CAPABILITIES = ['survey.edit', 'surveyGroup.manage'] as const;

/**
 * 그룹 구조 관문 — 슈퍼어드민 또는 그 팀의 active 멤버.
 *
 * 판정은 **입력의 teamId 로** 한다. "어딘가의 팀원인가" 를 물으면 A팀 팀원이 B팀 그룹을
 * 만든다(members 의 assertTeamManager 와 같은 이유).
 */
async function assertSurveyGroupManage(
  user: { id: string; isSuperadmin: boolean },
  teamId: string,
): Promise<void> {
  if (user.isSuperadmin) return;
  const memberships = await getActiveTeamMemberships(user.id);
  if (!memberships.some((m) => m.teamId === teamId)) {
    throw new ORPCError('FORBIDDEN', { message: '그룹 관리 권한이 없습니다.' });
  }
}

/**
 * groupId 만 받는 표면의 관문 — 그룹의 소유 팀을 조회해 같은 검사를 건다.
 *
 * 없는 그룹과 타 팀 그룹이 갈리면 id 를 훑어 타 팀 그룹의 존재를 확인할 수 있다. 팀이
 * 다르면 존재 자체를 모르는 것이 맞으므로 조회 결과가 없을 때와 같은 NOT_FOUND 로 접는다.
 */
async function assertSurveyGroupManageByGroupId(
  user: { id: string; isSuperadmin: boolean },
  groupId: string,
): Promise<void> {
  const teamId = await svc.getSurveyGroupTeamId(groupId);
  if (!teamId) throw new ORPCError('NOT_FOUND', { message: '그룹을 찾을 수 없습니다.' });
  if (user.isSuperadmin) return;
  const memberships = await getActiveTeamMemberships(user.id);
  if (!memberships.some((m) => m.teamId === teamId)) {
    throw new ORPCError('NOT_FOUND', { message: '그룹을 찾을 수 없습니다.' });
  }
}

/**
 * 그룹 도메인 에러 → RPC 코드.
 *
 * 팀 불일치·이미 담긴 설문은 CONFLICT 다 — 입력은 문법적으로 옳고 지금 상태와 충돌할 뿐이라,
 * 화면은 문구를 띄우고 목록을 다시 읽으면 된다.
 */
function rethrowSurveyGroupError(err: unknown): never {
  if (err instanceof SurveyGroupNotFoundError || err instanceof SurveyGroupTargetNotFoundError) {
    throw new ORPCError('NOT_FOUND', { message: err.message });
  }
  if (err instanceof DuplicateSurveyGroupNameError) {
    throw new ORPCError('CONFLICT', { message: err.message });
  }
  if (err instanceof SurveyTeamMismatchError || err instanceof SurveyAlreadyGroupedError) {
    throw new ORPCError('CONFLICT', { message: err.message });
  }
  throw toWorkspaceRpcError(err) ?? err;
}

const list = authed
  .input(ListSurveyGroupsInput)
  .output(ListSurveyGroupsOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyGroupManage(context.user, input.teamId);
    return svc.listSurveyGroups(input.teamId);
  });

const create = authed
  .input(CreateSurveyGroupInput)
  .output(CreateSurveyGroupOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyGroupManage(context.user, input.teamId);
    return svc.createSurveyGroup(context.user.id, input).catch(rethrowSurveyGroupError);
  });

const rename = authed
  .input(RenameSurveyGroupInput)
  .output(WorkspaceActionOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyGroupManageByGroupId(context.user, input.groupId);
    return svc.renameSurveyGroup(input).catch(rethrowSurveyGroupError);
  });

const reorder = authed
  .input(ReorderSurveyGroupsInput)
  .output(WorkspaceActionOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyGroupManage(context.user, input.teamId);
    return svc.reorderSurveyGroups(input).catch(rethrowSurveyGroupError);
  });

const remove = authed
  .input(SurveyGroupIdInput)
  .output(WorkspaceActionOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyGroupManageByGroupId(context.user, input.groupId);
    return svc.removeSurveyGroup(input.groupId).catch(rethrowSurveyGroupError);
  });

const listUngrouped = authed
  .input(ListUngroupedSurveysInput)
  .output(ListUngroupedSurveysOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyGroupManage(context.user, input.teamId);
    return svc.listUngroupedSurveys({
      user: context.user,
      teamId: input.teamId,
      query: input.query,
    });
  });

/**
 * 일괄 담기 — 그룹 쪽 팀 관문 + 설문별 capability 를 둘 다 지난다.
 *
 * 설문 관문을 배치로 도는 이유는 최대 200건이기 때문이다. 하나라도 막히면 전부 거부한다 —
 * 담기는 트랜잭션 하나라 부분 성공이라는 상태가 애초에 없다.
 */
const collect = authed
  .input(CollectSurveysIntoGroupInput)
  .output(WorkspaceActionOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyGroupManageByGroupId(context.user, input.groupId);
    await assertSurveyCapabilityBatchRpc(context.user, input.surveyIds, SURVEY_MOVE_CAPABILITIES);
    return svc.collectSurveysIntoGroup(input).catch(rethrowSurveyGroupError);
  });

/**
 * 단건 이동 (카드 케밥) — 설문 capability 가 판정의 전부다.
 *
 * 그룹 쪽 팀 관문을 따로 걸지 않는 것은 목적지 그룹의 팀을 서비스가 **잠긴 설문 행의
 * teamId** 와 대조하기 때문이다. 설문의 surveyGroup.manage 를 가진 주체는 그 설문 팀의
 * 사람이므로, 팀이 일치하는 그룹이면 그 그룹도 같은 팀 것이다. 미분류로 빼는 경우
 * (groupId=null)는 목적지 자체가 없다.
 */
const move = authed
  .input(MoveSurveyToGroupInput)
  .output(WorkspaceActionOutput)
  .handler(async ({ input, context }) => {
    await assertSurveyCapabilityBatchRpc(
      context.user,
      [input.surveyId],
      SURVEY_MOVE_CAPABILITIES,
    );
    return svc.moveSurveyToGroup(input).catch(rethrowSurveyGroupError);
  });

export const surveyGroups = {
  list,
  create,
  rename,
  reorder,
  remove,
  listUngrouped,
  collect,
  move,
};
