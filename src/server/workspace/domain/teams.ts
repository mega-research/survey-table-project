// 팀·멤버십 도메인 — 경계 계약(shared/contracts/workspace-io)의 재노출 + 서버 전용 규칙.
// client-safe — server-only·Node·DB 의존 없음.
import type { UserStatus, UserType } from '@/shared/contracts/auth';
import type { TeamRole } from '@/shared/contracts/workspace';

export {
  AddTeamMemberInput,
  AssignableUserItem,
  ChangeTeamMemberRoleInput,
  CreateTeamInput,
  CreateTeamOutput,
  DissolveTeamInput,
  ListTeamsOutput,
  RemoveTeamMemberInput,
  RenameTeamInput,
  SearchAssignableUsersInput,
  SearchAssignableUsersOutput,
  TeamDetailOutput,
  TeamIdInput,
  TeamListItem,
  TeamMemberItem,
  UpdateMemberJobTitleInput,
  WorkspaceActionOutput,
} from '@/shared/contracts/workspace-io';

// ─────────────────────────────────────────────────────────────────────────────
// 도메인 에러 — procedure 가 RPC 코드로 바꾼다
// ─────────────────────────────────────────────────────────────────────────────

/** 대상 팀이 없거나 이미 해산됐다(archived). procedure 가 NOT_FOUND 로 바꾼다. */
export class TeamNotFoundError extends Error {
  constructor() {
    super('팀을 찾을 수 없습니다.');
    this.name = 'TeamNotFoundError';
  }
}

/**
 * 해산 확인란에 적은 이름이 실제 팀 이름과 다르다 (티켓 13).
 *
 * 화면 검사만으로는 부족하다 — 이 대조가 서버에 없으면 확인란은 장식이 되고 raw RPC 한 번에
 * 팀이 사라진다. procedure 가 CONFLICT 로 바꾼다(입력 형식은 옳고 지금 상태와 다를 뿐이다).
 */
export class TeamNameMismatchError extends Error {
  constructor() {
    super('팀 이름이 일치하지 않습니다.');
    this.name = 'TeamNameMismatchError';
  }
}

/** 같은 이름의 활성 팀이 이미 있다 (teams_active_name_uq). */
export class DuplicateTeamNameError extends Error {
  constructor() {
    super('같은 이름의 팀이 이미 있습니다.');
    this.name = 'DuplicateTeamNameError';
  }
}

/** 지목한 사용자 계정이 없다 — 목록을 띄워둔 사이 사라졌거나 id 를 손으로 넣었다. */
export class TargetUserNotFoundError extends Error {
  constructor() {
    super('사용자를 찾을 수 없습니다.');
    this.name = 'TargetUserNotFoundError';
  }
}

/** 대상 사용자가 이 팀의 멤버가 아니다 — 목록을 띄워둔 사이 제외됐거나 id 를 손으로 넣었다. */
export class TeamMemberNotFoundError extends Error {
  constructor() {
    super('팀원을 찾을 수 없습니다.');
    this.name = 'TeamMemberNotFoundError';
  }
}

/** 팀 멤버십을 가질 수 없는 계정이다 (비활성·게스트·실사·슈퍼어드민). */
export class UnassignableUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnassignableUserError';
  }
}

/** 이미 이 팀 소속이다. */
export class AlreadyTeamMemberError extends Error {
  constructor() {
    super('이미 이 팀에 소속된 사용자입니다.');
    this.name = 'AlreadyTeamMemberError';
  }
}

/** 타 팀 active 멤버를 팀장이 당겨오려 했다 — 이동·겸직은 슈퍼어드민 전용이다. */
export class CrossTeamAssignmentError extends Error {
  constructor() {
    super('이미 소속 팀이 있는 사용자입니다. 이동이 필요하면 슈퍼어드민에게 요청하세요.');
    this.name = 'CrossTeamAssignmentError';
  }
}

/** 마지막 팀장을 강등·제외하려 했다 — 팀에 관리자가 없어진다. */
export class LastTeamLeaderError extends Error {
  constructor() {
    super('마지막 팀장은 강등하거나 제외할 수 없습니다.');
    this.name = 'LastTeamLeaderError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 순수 규칙 — 서비스가 행을 읽어 여기에 묻는다
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 이 사람을 이 팀에 넣어도 되는가 (.pen FLOW 7-3 의 pull 모델).
 *
 * 화면의 검색은 미배치 internal 만 돌려주지만, 검색은 편의일 뿐 판정이 아니다 — 입력의
 * userId 는 손으로 갈아끼울 수 있으므로 같은 규칙을 여기서 다시 세운다.
 *
 * 겸직(복수 팀 동시 소속)은 어휘상 허용이지만(CONTEXT.md 「팀」) 만드는 권한은 좁다.
 * 팀장의 pull 은 미배치 사용자 전용이고, 타 팀 멤버를 건드리는 일은 슈퍼어드민 몫이다 —
 * 그러지 않으면 팀장이 남의 팀 사람을 마음대로 데려갈 수 있다.
 */
export function assertMemberAssignable(input: {
  actor: { isSuperadmin: boolean };
  target: { status: UserStatus; userType: UserType; isSuperadmin: boolean };
  teamId: string;
  /** 대상이 지금 소속된 **활성** 팀들. archived 팀은 유효 소속이 아니므로 들어오지 않는다. */
  activeTeamIds: readonly string[];
}): void {
  const { actor, target, teamId, activeTeamIds } = input;

  if (target.userType !== 'internal') {
    throw new UnassignableUserError('내부 계정만 팀에 소속될 수 있습니다.');
  }
  if (target.status !== 'active') {
    throw new UnassignableUserError('재직 중 사용자만 팀에 추가할 수 있습니다.');
  }
  if (target.isSuperadmin) {
    // 슈퍼어드민은 팀 소속과 무관한 전역 관리자다(CONTEXT.md). 팀에 넣으면 그 팀 팀장이
    // 슈퍼어드민의 직책까지 고칠 수 있게 되므로, 어휘와 권한 양쪽에서 막는다.
    throw new UnassignableUserError('슈퍼어드민은 팀에 소속되지 않습니다.');
  }
  if (activeTeamIds.includes(teamId)) {
    throw new AlreadyTeamMemberError();
  }
  if (activeTeamIds.length > 0 && !actor.isSuperadmin) {
    throw new CrossTeamAssignmentError();
  }
}

/**
 * 이 팀에 팀을 관리할 수 있는 사람이 남는가 — 역할 강등과 제외가 함께 본다.
 *
 * 세는 것은 **활성 팀장**이다. 정지·퇴사한 팀장은 로그인조차 못 하므로 팀을 지키지 못한다.
 * 그리고 **대상이 비활성이면 아예 묻지 않는다** — 그러지 않으면 유일한 팀장이 퇴사한 순간
 * 강등도 제외도 거부되어(활성 팀장 0명) 팀이 유령 팀장에 잠긴다. 지켜야 할 것은
 * "관리자가 남는가" 이지 "leader 행이 남는가" 가 아니다.
 *
 * (activeLeaderCount 는 대상이 활성 팀장이면 대상을 포함한 수다.)
 */
export function assertLastLeaderKept(input: {
  currentRole: TeamRole;
  targetIsActive: boolean;
  activeLeaderCount: number;
}): void {
  if (input.currentRole !== 'leader' || !input.targetIsActive) return;
  if (input.activeLeaderCount <= 1) {
    throw new LastTeamLeaderError();
  }
}
