// 워크스페이스 경계 계약 — 팀 관리 화면(.pen FLOW 7)이 경계를 건너는 모양.
// 같은 폴더의 workspace.ts — 팀 어휘(status·role·감사) SSOT. 이 파일 — 서버와 UI 사이 RPC 입출력.
// client-safe — server-only·Node·DB 의존 없음(zod 는 런타임 의존).
import * as z from 'zod';

import { userStatusValues } from './auth';
import { teamRoleValues } from './workspace';

const TeamRoleSchema = z.enum(teamRoleValues);

/** 팀 이름 — 전체 조직 경로를 담는다(`연구1본부 - 1팀`). 표시용이지만 활성 팀 안에서 유일하다. */
const TeamNameField = z.string().trim().min(1, '팀 이름을 입력하세요.').max(100);

// ─────────────────────────────────────────────────────────────────────────────
// 팀 관리 목록 (.pen FLOW 7-1)
// ─────────────────────────────────────────────────────────────────────────────

export const TeamListItem = z.object({
  id: z.uuid(),
  name: z.string(),
  memberCount: z.number().int(),
  /**
   * 이 팀이 소유한 설문 수.
   *
   * 티켓 06 시점에는 설문이 팀에 귀속되지 않아(surveys.team_id 는 티켓 07) 항상 0 이다.
   * 거짓 값이 아니라 사실이다 — 아직 어떤 설문도 팀 소유가 아니고, 07 의 백필도 기존
   * 설문을 배치 대기(team_id=null)로 넣는다. 07 이 이 자리를 실제 집계로 바꾼다.
   */
  surveyCount: z.number().int(),
});
export type TeamListItem = z.infer<typeof TeamListItem>;

/**
 * 팀 관리 목록 + 메가리서치 카드 지표.
 *
 * 「메가리서치」는 팀이 아니라 슈퍼어드민의 시스템 전체 보기다(ADR-0006) — teams 행이
 * 없으므로 카드에 쓸 숫자를 목록과 따로 얹는다. 케밥도 없다(해산·상세 대상이 아니다).
 */
export const ListTeamsOutput = z.object({
  teams: z.array(TeamListItem),
  systemSummary: z.object({
    teamCount: z.number().int(),
    /** 삭제되지 않은 전체 설문 수 — 팀 귀속과 무관하게 지금도 셀 수 있다. */
    surveyCount: z.number().int(),
  }),
});
export type ListTeamsOutput = z.infer<typeof ListTeamsOutput>;

// ─────────────────────────────────────────────────────────────────────────────
// 팀 상세 (.pen FLOW 7-2)
// ─────────────────────────────────────────────────────────────────────────────

export const TeamMemberItem = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  /** 직책 — users 전역 속성. 팀 상세에서 팀장·슈퍼어드민이 인라인 편집한다. */
  jobTitle: z.string().nullable(),
  role: TeamRoleSchema,
  /**
   * 계정 상태. 팀 상세는 비활성 멤버도 그대로 보여주고 표식을 단다 — 안 보이면 정지·퇴사한
   * 사람이 팀장 자리를 차지한 채 남아 있는 것을 아무도 눈치채지 못한다.
   */
  status: z.enum(userStatusValues),
  /**
   * 이 사람이 **다른** 활성 팀에 소속된 수. 0 이면 겸직 없음.
   * .pen 7-2 의 `· 2팀 겸직` 표기가 이 값에서 나온다.
   */
  otherTeamCount: z.number().int(),
});
export type TeamMemberItem = z.infer<typeof TeamMemberItem>;

/**
 * 팀 상세.
 *
 * canManageMembers / canManageSettings 는 화면이 버튼을 감추는 데 쓰는 힌트일 뿐이다 —
 * 판정의 정본은 서버다. 둘을 나눠 두는 이유는 팀장이 사람은 다루되 조직도(팀 이름)는
 * 다루지 않기 때문이다(ADR-0008).
 */
export const TeamDetailOutput = z.object({
  id: z.uuid(),
  name: z.string(),
  memberCount: z.number().int(),
  surveyCount: z.number().int(),
  members: z.array(TeamMemberItem),
  canManageMembers: z.boolean(),
  canManageSettings: z.boolean(),
});
export type TeamDetailOutput = z.infer<typeof TeamDetailOutput>;

export const TeamIdInput = z.object({ teamId: z.uuid() });
export type TeamIdInput = z.infer<typeof TeamIdInput>;

// ─────────────────────────────────────────────────────────────────────────────
// 팀 생성·이름 변경 (슈퍼어드민)
// ─────────────────────────────────────────────────────────────────────────────

export const CreateTeamInput = z.object({ name: TeamNameField });
export type CreateTeamInput = z.infer<typeof CreateTeamInput>;

/** 생성 직후 응답 — drizzle raw row(status·archivedBy 등 내부 컬럼)를 노출하지 않는다. */
export const CreateTeamOutput = z.object({ id: z.uuid() });
export type CreateTeamOutput = z.infer<typeof CreateTeamOutput>;

export const RenameTeamInput = z.object({ teamId: z.uuid(), name: TeamNameField });
export type RenameTeamInput = z.infer<typeof RenameTeamInput>;

// ─────────────────────────────────────────────────────────────────────────────
// 멤버십 (.pen FLOW 7-2·7-3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 팀원 추가 검색 (.pen FLOW 7-3) — **미배치 internal 사용자만** 잡힌다.
 *
 * 타 팀 active 멤버는 검색되지 않는다("이동이 필요하면 슈퍼어드민에게 요청하세요"),
 * guest·fieldwork 는 팀 멤버십 자체가 금지다(스펙 §1), 슈퍼어드민은 팀 소속과 무관하다.
 */
export const SearchAssignableUsersInput = z.object({
  teamId: z.uuid(),
  query: z.string().trim().max(100).default(''),
});
export type SearchAssignableUsersInput = z.infer<typeof SearchAssignableUsersInput>;

export const AssignableUserItem = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  jobTitle: z.string().nullable(),
});
export type AssignableUserItem = z.infer<typeof AssignableUserItem>;

export const SearchAssignableUsersOutput = z.array(AssignableUserItem);
export type SearchAssignableUsersOutput = z.infer<typeof SearchAssignableUsersOutput>;

export const AddTeamMemberInput = z.object({
  teamId: z.uuid(),
  userId: z.uuid(),
  role: TeamRoleSchema.default('member'),
});
export type AddTeamMemberInput = z.infer<typeof AddTeamMemberInput>;

export const ChangeTeamMemberRoleInput = z.object({
  teamId: z.uuid(),
  userId: z.uuid(),
  role: TeamRoleSchema,
});
export type ChangeTeamMemberRoleInput = z.infer<typeof ChangeTeamMemberRoleInput>;

export const RemoveTeamMemberInput = z.object({ teamId: z.uuid(), userId: z.uuid() });
export type RemoveTeamMemberInput = z.infer<typeof RemoveTeamMemberInput>;

/**
 * 직책 수정 — 직책은 users 전역 속성이지만 **팀 상세에서만** 고친다.
 *
 * teamId 는 장식이 아니라 권한 축이다: 서버가 "요청자가 그 팀의 관리자인가" 와
 * "대상이 그 팀 소속인가" 를 둘 다 확인한다. 대상 확인이 빠지면 팀 A 팀장이 userId 만
 * 갈아끼워 타 팀·미배치·슈퍼어드민의 직책을 바꿀 수 있다(워크트리 Task 4 의 IDOR).
 */
export const UpdateMemberJobTitleInput = z.object({
  teamId: z.uuid(),
  userId: z.uuid(),
  jobTitle: z.string().trim().max(50).nullable(),
});
export type UpdateMemberJobTitleInput = z.infer<typeof UpdateMemberJobTitleInput>;

/** 성공만 알리면 되는 변경 — 화면은 목록을 다시 읽는다. */
export const WorkspaceActionOutput = z.object({ success: z.literal(true) });
export type WorkspaceActionOutput = z.infer<typeof WorkspaceActionOutput>;
