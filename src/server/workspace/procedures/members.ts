import { ORPCError } from '@orpc/server';

import { authed } from '@/server/orpc';
import { getTeamRole } from '@/server/read-models/team-memberships';
import { canManageTeamMembers } from '@/shared/contracts/workspace';

import {
  AddTeamMemberInput,
  AlreadyTeamMemberError,
  ChangeTeamMemberRoleInput,
  CrossTeamAssignmentError,
  LastTeamLeaderError,
  MemberOwnsSurveysError,
  RemoveTeamMemberInput,
  SearchAssignableUsersInput,
  SearchAssignableUsersOutput,
  TargetUserNotFoundError,
  TeamMemberNotFoundError,
  UnassignableUserError,
  UpdateMemberJobTitleInput,
  WorkspaceActionOutput,
} from '../domain/teams';
import * as svc from '../services/members';
import { toWorkspaceRpcError } from './teams';

/**
 * team.manageMembers 관문 — 해당 팀 팀장 또는 슈퍼어드민.
 *
 * 팀장 판정은 **입력의 teamId 로** 한다. "어딘가의 팀장인가" 가 아니라 "이 팀의 팀장인가" 를
 * 물어야 A팀 팀장이 B팀 멤버를 만지지 못한다.
 */
async function assertTeamManager(
  user: { id: string; isSuperadmin: boolean },
  teamId: string,
): Promise<void> {
  // 슈퍼어드민은 소속을 묻지 않는다(왕복 회피). 판정 자체는 아래 술어 하나가 한다.
  const role = user.isSuperadmin ? null : await getTeamRole(user.id, teamId);
  if (!canManageTeamMembers(user, role)) {
    throw new ORPCError('FORBIDDEN', { message: '팀 관리 권한이 없습니다.' });
  }
}

/**
 * 멤버십 도메인 에러 → RPC 코드.
 *
 * 추가 거부(비활성·유형·겸직)와 마지막 팀장 가드는 CONFLICT 다 — 입력은 문법적으로 옳고
 * 지금 상태와 충돌할 뿐이라, 화면은 문구를 그대로 띄우고 목록을 다시 읽으면 된다.
 */
function rethrowMemberError(err: unknown): never {
  if (err instanceof TeamMemberNotFoundError || err instanceof TargetUserNotFoundError) {
    throw new ORPCError('NOT_FOUND', { message: err.message });
  }
  if (
    err instanceof UnassignableUserError ||
    err instanceof AlreadyTeamMemberError ||
    err instanceof CrossTeamAssignmentError ||
    err instanceof LastTeamLeaderError ||
    // 소유 설문이 남은 사람의 제외 — 먼저 이전하라는 안내다(티켓 19).
    err instanceof MemberOwnsSurveysError
  ) {
    throw new ORPCError('CONFLICT', { message: err.message });
  }
  throw toWorkspaceRpcError(err) ?? err;
}

/** 팀원 추가 검색 (.pen FLOW 7-3) — 미배치 internal 사용자만 잡힌다. */
const searchAssignable = authed
  .input(SearchAssignableUsersInput)
  .output(SearchAssignableUsersOutput)
  .handler(async ({ input, context }) => {
    await assertTeamManager(context.user, input.teamId);
    // 후보 모집단이 주체에 따라 갈린다 — 슈퍼어드민만 타 팀 멤버를 겸직으로 당길 수 있다.
    return svc.searchAssignableUsers({ isSuperadmin: context.user.isSuperadmin }, input);
  });

/** 팀원 추가 — 타 팀 active 멤버를 당겨오는 것은 슈퍼어드민만 할 수 있다. */
const add = authed
  .input(AddTeamMemberInput)
  .output(WorkspaceActionOutput)
  .handler(async ({ input, context }) => {
    await assertTeamManager(context.user, input.teamId);
    return svc
      .addMember({ id: context.user.id, isSuperadmin: context.user.isSuperadmin }, input)
      .catch(rethrowMemberError);
  });

/** 역할 변경 (팀장/팀원) — 마지막 팀장 강등 금지. */
const changeRole = authed
  .input(ChangeTeamMemberRoleInput)
  .output(WorkspaceActionOutput)
  .handler(async ({ input, context }) => {
    await assertTeamManager(context.user, input.teamId);
    return svc.changeMemberRole(context.user.id, input).catch(rethrowMemberError);
  });

/** 팀원 제외 — 마지막 팀장 제외 금지. */
const remove = authed
  .input(RemoveTeamMemberInput)
  .output(WorkspaceActionOutput)
  .handler(async ({ input, context }) => {
    await assertTeamManager(context.user, input.teamId);
    return svc.removeMember(context.user.id, input).catch(rethrowMemberError);
  });

/** 직책 수정 — 요청자의 팀 권한과 **대상의 팀 소속**을 둘 다 본다(서비스 주석 참조). */
const updateJobTitle = authed
  .input(UpdateMemberJobTitleInput)
  .output(WorkspaceActionOutput)
  .handler(async ({ input, context }) => {
    await assertTeamManager(context.user, input.teamId);
    return svc.updateMemberJobTitle(input).catch(rethrowMemberError);
  });

export const members = { searchAssignable, add, changeRole, remove, updateJobTitle };
