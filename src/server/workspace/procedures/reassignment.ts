import { ORPCError } from '@orpc/server';

import { superadmin } from '@/server/orpc';

import {
  AssignSurveysInput,
  AssignSurveysOutput,
  AssignUserToTeamInput,
  ListOwnerCandidatesOutput,
  OwnerNotInTeamError,
  PendingSurveyDetailOutput,
  ReassignmentInboxOutput,
  SurveyIdOnlyInput,
  SurveyNotPendingError,
  TeamIdInput,
  UserAlreadyAssignedError,
} from '../domain/reassignment';
import {
  AlreadyTeamMemberError,
  TargetUserNotFoundError,
  TeamMemberNotFoundError,
  UnassignableUserError,
  WorkspaceActionOutput,
} from '../domain/teams';
import * as svc from '../services/reassignment';
import { toWorkspaceRpcError } from './teams';

/**
 * 재배치 도메인 에러 → RPC 코드.
 *
 * 거부는 거의 전부 CONFLICT 다 — 입력은 문법적으로 옳고 **인박스가 보여준 상태와 지금
 * 상태가 다를 뿐**이라, 화면이 할 일은 문구를 띄우고 목록을 다시 읽는 것이다. 새 소유자가
 * 목적지 팀 밖인 것만 BAD_REQUEST 다: 그건 화면이 애초에 고를 수 없는 조합이라(후보 목록이
 * 같은 모집단을 본다) 상태 변화가 아니라 잘못된 입력이다.
 */
function rethrowReassignmentError(err: unknown): never {
  if (err instanceof TargetUserNotFoundError || err instanceof TeamMemberNotFoundError) {
    throw new ORPCError('NOT_FOUND', { message: err.message });
  }
  if (err instanceof OwnerNotInTeamError) {
    throw new ORPCError('BAD_REQUEST', { message: err.message });
  }
  if (
    err instanceof UserAlreadyAssignedError ||
    err instanceof SurveyNotPendingError ||
    err instanceof AlreadyTeamMemberError ||
    err instanceof UnassignableUserError
  ) {
    throw new ORPCError('CONFLICT', { message: err.message });
  }
  throw toWorkspaceRpcError(err) ?? err;
}

/**
 * 재배치 센터 인박스 (.pen FLOW 8-2) — 슈퍼어드민 전용.
 *
 * 팀장에게 열지 않는다. 여기 있는 사람과 설문은 **어느 팀에도 속하지 않는 것들**이라 팀
 * 경계로 좁힐 수 없고, 좁힐 수 없는 목록을 팀장에게 주면 그 순간 전사 열람이 된다.
 * 티켓 파일의 「팀장은 재배치 센터 접근 불가, teamId 딥링크 없음」이 이 뜻이다.
 */
const inbox = superadmin.output(ReassignmentInboxOutput).handler(() => svc.getReassignmentInbox());

/** 단건 재배치 화면(.pen FLOW 8-4)이 여는 설문 — 배치 대기가 아니면 없는 설문과 같이 null. */
const pendingSurvey = superadmin
  .input(SurveyIdOnlyInput)
  .output(PendingSurveyDetailOutput.nullable())
  .handler(({ input }) => svc.getPendingSurvey(input.surveyId));

/** 새 소유자 후보 = 목적지 팀의 active internal 멤버 (서비스 주석의 불변식 참조). */
const ownerCandidates = superadmin
  .input(TeamIdInput)
  .output(ListOwnerCandidatesOutput)
  .handler(({ input }) => svc.listOwnerCandidates(input.teamId));

/** 미배치 사용자 팀 배정 (.pen FLOW 8-3). */
const assignUser = superadmin
  .input(AssignUserToTeamInput)
  .output(WorkspaceActionOutput)
  .handler(({ context, input }) =>
    svc.assignUserToTeam(context.user, input).catch(rethrowReassignmentError),
  );

/** 배치 대기 설문 배치 — 단건도 일괄도 같은 입구다(한 건이라도 실패하면 전체 취소). */
const assignSurveys = superadmin
  .input(AssignSurveysInput)
  .output(AssignSurveysOutput)
  .handler(({ context, input }) =>
    svc.assignSurveys(context.user.id, input).catch(rethrowReassignmentError),
  );

export const reassignment = {
  inbox,
  pendingSurvey,
  ownerCandidates,
  assignUser,
  assignSurveys,
};
