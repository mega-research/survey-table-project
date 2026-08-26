// 워크스페이스 계약 — 팀·멤버십 어휘 SSOT (역할 모델 v2 티켓 06).
// DB 스키마($type<>)·서버·UI 가 공유하는 어휘 — 런타임 의존 없음(리터럴 상수·순수 술어 제외).
// 같은 폴더의 workspace-io.ts — 서버와 UI 사이 RPC 입출력.

// ─────────────────────────────────────────────────────────────────────────────
// teams.status — 팀 수명 (SSOT)
// ─────────────────────────────────────────────────────────────────────────────
//
// 해산은 행 삭제가 아니라 archived 전환이다(ADR-0011). archived 팀의 멤버십 행은 감사용으로
// 남지만 **유효 소속으로 계산하지 않는다** — 해산 즉시 팀원은 미배치가 된다.

export const teamStatusValues = ['active', 'archived'] as const;
export type TeamStatus = (typeof teamStatusValues)[number];

// ─────────────────────────────────────────────────────────────────────────────
// team_members.role — 팀 역할 (SSOT)
// ─────────────────────────────────────────────────────────────────────────────
//
// 팀장은 자기 팀의 멤버 관리(추가·역할 변경·제외·직책)를 할 수 있고, 팀원은 못 한다.
// 팀에 게스트 역할은 없다 — 게스트는 설문 단위 개념이다(스펙 §5).

export const teamRoleValues = ['leader', 'member'] as const;
export type TeamRole = (typeof teamRoleValues)[number];

/** 화면 표기. 서버 어휘와 UI 문구를 한 자리에서 잇는다. */
export const TEAM_ROLE_LABEL: Record<TeamRole, string> = {
  leader: '팀장',
  member: '팀원',
};

// ─────────────────────────────────────────────────────────────────────────────
// team_lifecycle_events — 팀 감사 어휘 (팀 자체 + 멤버 구성)
// ─────────────────────────────────────────────────────────────────────────────
//
// 멤버 사건까지 한 테이블에 남기는 이유는 제외가 team_members 행을 지우기 때문이다 —
// 감사 행이 없으면 "누가 언제 누구를 뺐는가" 가 어디에도 남지 않는다.
// dissolve 는 티켓 13 이 쓴다. 어휘를 지금 함께 두는 이유는 CHECK 제약이 이미 값을 알고
// 있어서다 — 나중에 값을 늘리려면 마이그레이션이 또 필요하다.

export const teamLifecycleActionValues = [
  'create',
  'rename',
  'dissolve',
  'member_add',
  'member_role',
  'member_remove',
] as const;
export type TeamLifecycleAction = (typeof teamLifecycleActionValues)[number];

/**
 * 감사 행의 metadata JSONB.
 *
 * 팀 이름·역할은 바뀌므로 사건 시점의 값을 함께 남긴다 — 나중에 teams·team_members 를
 * 조인하면 지금 값만 보이고 "그때 무엇이 어떻게 바뀌었는가" 를 알 수 없다.
 */
export interface TeamLifecycleMetadata {
  teamName?: string;
  previousName?: string;
  /** 멤버 사건의 역할 — member_add 는 to 만, member_role 은 from·to 둘 다. */
  fromRole?: TeamRole;
  toRole?: TeamRole;
}

// ─────────────────────────────────────────────────────────────────────────────
// 팀 관리 권한 — 화면과 서버가 함께 보는 술어
// ─────────────────────────────────────────────────────────────────────────────

/** 이 사람이 그 팀의 멤버 관리를 할 수 있는가 — 해당 팀 팀장 또는 슈퍼어드민. */
export function canManageTeamMembers(
  actor: { isSuperadmin: boolean },
  membershipRole: TeamRole | null,
): boolean {
  return actor.isSuperadmin || membershipRole === 'leader';
}

/**
 * 팀 자체(이름·설명·생성·해산)를 다룰 수 있는가 — 슈퍼어드민만.
 *
 * 팀 이름은 전체 조직 경로다(ADR-0008). 조직 구조를 바꾸는 일이라 팀장에게 열지 않는다 —
 * 팀장이 다루는 것은 자기 팀의 사람이지 조직도가 아니다.
 */
export function canManageTeamSettings(actor: { isSuperadmin: boolean }): boolean {
  return actor.isSuperadmin;
}
