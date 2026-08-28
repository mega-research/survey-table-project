// 워크스페이스 경계 계약 — 팀 관리 화면(.pen FLOW 7)이 경계를 건너는 모양.
// 같은 폴더의 workspace.ts — 팀 어휘(status·role·감사) SSOT. 이 파일 — 서버와 UI 사이 RPC 입출력.
// client-safe — server-only·Node·DB 의존 없음(zod 는 런타임 의존).
import * as z from 'zod';

import { userStatusValues } from './auth';
import { surveyVisibilityValues, teamRoleValues } from './workspace';

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

/**
 * 팀 해산 (.pen FLOW 8-1) — **확인 문구로 팀 이름을 다시 받는다.**
 *
 * 되돌릴 수 없는 일이라 오조작 한 번이 팀 전체를 미배치로 만든다. 그룹 삭제는 이름 입력이
 * 없는데(되돌릴 수 있다) 해산에는 있는 이유가 그것이다. 서버도 이 값을 실제 팀 이름과
 * 대조한다 — 화면만 검사하면 raw RPC 한 번으로 우회된다.
 */
export const DissolveTeamInput = z.object({
  teamId: z.uuid(),
  // 저장된 이름은 이미 trim 돼 있다(TeamNameField). 붙여넣기에 딸려온 공백 때문에 버튼이
  // 사유 없이 잠긴 것처럼 보이지 않도록 여기서 접는다 — 화면과 서버가 같은 규칙을 본다.
  confirmName: z.string().trim(),
});
export type DissolveTeamInput = z.infer<typeof DissolveTeamInput>;

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

// ─────────────────────────────────────────────────────────────────────────────
// 설문 그룹 (.pen FLOW 2) — 팀 공용 정리용 묶음
// ─────────────────────────────────────────────────────────────────────────────

/** 그룹 이름 — 팀 안에서 유일하다. 팀 이름보다 짧게 쓰는 폴더 라벨이라 60자. */
const SurveyGroupNameField = z.string().trim().min(1, '그룹 이름을 입력하세요.').max(60);

export const SurveyGroupListItem = z.object({
  id: z.uuid(),
  name: z.string(),
  order: z.number().int(),
  /** 소속 설문 수 — 삭제되지 않은 설문만 센다(삭제 확인 모달의 「설문 N개가 미분류로」). */
  surveyCount: z.number().int(),
});
export type SurveyGroupListItem = z.infer<typeof SurveyGroupListItem>;

export const ListSurveyGroupsInput = z.object({ teamId: z.uuid() });
export type ListSurveyGroupsInput = z.infer<typeof ListSurveyGroupsInput>;

export const ListSurveyGroupsOutput = z.array(SurveyGroupListItem);
export type ListSurveyGroupsOutput = z.infer<typeof ListSurveyGroupsOutput>;

export const CreateSurveyGroupInput = z.object({ teamId: z.uuid(), name: SurveyGroupNameField });
export type CreateSurveyGroupInput = z.infer<typeof CreateSurveyGroupInput>;

/** 생성 직후 응답 — drizzle raw row(teamId·createdBy 등 내부 컬럼)를 노출하지 않는다. */
export const CreateSurveyGroupOutput = z.object({ id: z.uuid() });
export type CreateSurveyGroupOutput = z.infer<typeof CreateSurveyGroupOutput>;

export const RenameSurveyGroupInput = z.object({
  groupId: z.uuid(),
  name: SurveyGroupNameField,
});
export type RenameSurveyGroupInput = z.infer<typeof RenameSurveyGroupInput>;

/**
 * 정렬 — 화면이 보여주는 순서 전체를 통째로 보낸다.
 *
 * teamId 를 함께 받는 것은 장식이 아니라 권한 축이다. 서버는 요청자가 그 팀의 팀원인지 묻고,
 * UPDATE 도 그 teamId 로 좁힌다 — 타 팀 groupId 가 배열에 섞여도 아무 행에도 닿지 않는다.
 */
export const ReorderSurveyGroupsInput = z.object({
  teamId: z.uuid(),
  orderedGroupIds: z.array(z.uuid()).min(1).max(200),
});
export type ReorderSurveyGroupsInput = z.infer<typeof ReorderSurveyGroupsInput>;

export const SurveyGroupIdInput = z.object({ groupId: z.uuid() });
export type SurveyGroupIdInput = z.infer<typeof SurveyGroupIdInput>;

/**
 * 「설문 담기」 후보 — **미분류 설문만** 나온다 (.pen FLOW 2-2).
 *
 * 다른 그룹에 있는 설문을 여기서 빼오는 암묵 이동을 원천 차단하려는 것이다. 그룹 간 이동은
 * 설문 카드 케밥의 단건 동선(FLOW 2-4)만 쓴다.
 */
export const ListUngroupedSurveysInput = z.object({
  teamId: z.uuid(),
  query: z.string().trim().max(100).default(''),
});
export type ListUngroupedSurveysInput = z.infer<typeof ListUngroupedSurveysInput>;

export const UngroupedSurveyItem = z.object({
  id: z.uuid(),
  title: z.string(),
  updatedAt: z.date(),
  /** 담기 가능 여부 — 서버가 capability 로 판정한다. false 인 행은 화면에서 선택 비활성. */
  canMove: z.boolean(),
});
export type UngroupedSurveyItem = z.infer<typeof UngroupedSurveyItem>;

export const ListUngroupedSurveysOutput = z.array(UngroupedSurveyItem);
export type ListUngroupedSurveysOutput = z.infer<typeof ListUngroupedSurveysOutput>;

/**
 * 일괄 담기 — 같은 id 가 두 번 들어와도 한 번으로 접는다.
 *
 * 접지 않으면 "요청 수 == 조회된 행 수" 검증이 중복 때문에 오탐으로 NOT_FOUND 를 던진다.
 */
export const CollectSurveysIntoGroupInput = z.object({
  groupId: z.uuid(),
  surveyIds: z
    .array(z.uuid())
    .min(1)
    .max(200)
    .transform((ids) => [...new Set(ids)]),
});
export type CollectSurveysIntoGroupInput = z.infer<typeof CollectSurveysIntoGroupInput>;

/** 단건 이동 (카드 케밥) — `groupId: null` 은 미분류로 이동(그룹에서 빼기). */
export const MoveSurveyToGroupInput = z.object({
  surveyId: z.uuid(),
  groupId: z.uuid().nullable(),
});
export type MoveSurveyToGroupInput = z.infer<typeof MoveSurveyToGroupInput>;

// ─────────────────────────────────────────────────────────────────────────────
// 재배치 센터 (.pen FLOW 8-2~8-4·9-2) — 슈퍼어드민 전용 인박스
// ─────────────────────────────────────────────────────────────────────────────
//
// 해산이 만들어낸 두 종류의 고아를 한곳에서 처리한다: 팀을 잃은 **사람**(미배치)과 팀을 잃은
// **설문**(배치 대기). 팀 관리의 「메가리서치」 카드가 유일한 입구다 — 팀이 아니라 시스템
// 전체 보기라 재배치가 그 카드의 일이다(ADR-0006).

const SurveyVisibilitySchema = z.enum(surveyVisibilityValues);

/** 인박스 머리의 지표 셋 (.pen 8-2). 「처리 대기」 배지는 사용자 + 설문의 합이다. */
export const ReassignmentSummary = z.object({
  archivedTeamCount: z.number().int(),
  unassignedUserCount: z.number().int(),
  pendingSurveyCount: z.number().int(),
});
export type ReassignmentSummary = z.infer<typeof ReassignmentSummary>;

export const UnassignedUserItem = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  jobTitle: z.string().nullable(),
  /**
   * 직전 소속 팀 이름 (.pen 8-2 의 `연구1본부 - 1팀 (해산)`).
   *
   * 해산이 team_members 행을 **지우지 않기** 때문에 읽을 수 있는 값이다(ADR-0011, 티켓 13).
   * 미배치인데 멤버십 행이 남아 있다면 그 팀은 archived 일 수밖에 없으므로 별도 플래그를
   * 두지 않는다 — active 팀 행이 있으면 애초에 미배치가 아니다.
   * 제외로 미배치가 된 사람은 행이 지워져 null 이다.
   */
  previousTeamName: z.string().nullable(),
});
export type UnassignedUserItem = z.infer<typeof UnassignedUserItem>;

export const PendingSurveyItem = z.object({
  surveyId: z.uuid(),
  title: z.string(),
  ownerUserId: z.uuid().nullable(),
  /** 소유자 이름. null 이면 소유자가 없는 설문(팀 도입 이전 백필분)이라 화면이 메가리서치로 적는다. */
  ownerName: z.string().nullable(),
  /** 소유자도 지금 미배치인가 (.pen 8-4 의 `박도윤 · 미배치 (해산)`). */
  ownerIsUnassigned: z.boolean(),
  /** 감사(survey_ownership_events)에서 되짚은 출신 팀. 설문 행에는 남지 않는다. */
  previousTeamName: z.string().nullable(),
  updatedAt: z.string(),
});
export type PendingSurveyItem = z.infer<typeof PendingSurveyItem>;

export const ReassignmentInboxOutput = z.object({
  summary: ReassignmentSummary,
  unassignedUsers: z.array(UnassignedUserItem),
  pendingSurveys: z.array(PendingSurveyItem),
});
export type ReassignmentInboxOutput = z.infer<typeof ReassignmentInboxOutput>;

/**
 * 미배치 사용자 팀 배정 (.pen 8-3).
 *
 * 팀 상세의 「팀원 추가」와 같은 일을 하지만 입구가 다르다 — 저쪽은 팀장이 자기 팀으로
 * 당기는 pull, 이쪽은 슈퍼어드민이 목적지를 정해 밀어넣는 push 다. 직책을 함께 받는 것도
 * 이쪽뿐이다(해산으로 소속을 잃은 사람의 직책을 새 팀 기준으로 다시 적는 자리라서).
 */
export const AssignUserToTeamInput = z.object({
  userId: z.uuid(),
  teamId: z.uuid(),
  role: TeamRoleSchema,
  /** 빈 문자열은 「직책 없음」이다 — 화면의 선택 입력이라 미입력과 지우기를 가르지 않는다. */
  jobTitle: z.string().trim().max(50).nullable(),
});
export type AssignUserToTeamInput = z.infer<typeof AssignUserToTeamInput>;

/**
 * 배치 대기 설문 배치 (.pen 8-4 단건 · 9-2 일괄).
 *
 * 단건과 일괄이 **같은 입력**이다 — 화면 둘이 하는 일이 「선택한 설문들에 같은 목적지·소유자·
 * 공개 범위를 적용한다」로 정확히 같고, 단건은 그 목록의 길이가 1 인 경우다. 계약을 가르면
 * 원자성 규칙(한 건이라도 실패하면 전체 취소)이 두 벌이 된다.
 */
export const AssignSurveysInput = z.object({
  surveyIds: z
    .array(z.uuid())
    .min(1, '설문을 하나 이상 선택하세요.')
    .max(200, '한 번에 200건까지 배치할 수 있습니다.')
    .transform((ids) => [...new Set(ids)]),
  teamId: z.uuid(),
  ownerUserId: z.uuid(),
  visibility: SurveyVisibilitySchema,
});
export type AssignSurveysInput = z.infer<typeof AssignSurveysInput>;

/** 몇 건이 실제로 움직였는가 — 화면이 「N건을 배치했습니다」로 쓴다. */
export const AssignSurveysOutput = z.object({ assignedCount: z.number().int() });
export type AssignSurveysOutput = z.infer<typeof AssignSurveysOutput>;

/** 새 소유자 후보 = 목적지 팀의 **active internal 멤버**. 이유는 서비스 주석 참조. */
export const OwnerCandidateItem = z.object({
  userId: z.uuid(),
  name: z.string(),
  jobTitle: z.string().nullable(),
  role: TeamRoleSchema,
});
export type OwnerCandidateItem = z.infer<typeof OwnerCandidateItem>;

export const ListOwnerCandidatesOutput = z.array(OwnerCandidateItem);
export type ListOwnerCandidatesOutput = z.infer<typeof ListOwnerCandidatesOutput>;

/** 단건 재배치 화면(.pen 8-4)이 여는 설문 하나. */
export const PendingSurveyDetailOutput = PendingSurveyItem;
export type PendingSurveyDetailOutput = z.infer<typeof PendingSurveyDetailOutput>;

export const SurveyIdOnlyInput = z.object({ surveyId: z.uuid() });
export type SurveyIdOnlyInput = z.infer<typeof SurveyIdOnlyInput>;

// ─────────────────────────────────────────────────────────────────────────────
// 공유 설정 — 공개 범위 (.pen FLOW 4-2, 티켓 16)
// ─────────────────────────────────────────────────────────────────────────────
//
// 공개 범위만 별도 표면인 것은 권한 축이 다르기 때문이다. 설문 편집(`survey.edit`)은
// 팀원도 갖지만 범위 변경은 `survey.manageAccess` — 소유자·소유 팀 팀장·슈퍼어드민뿐이다
// (스펙 §7). 그래서 `UpdateSurveyDataSchema` 의 allowlist 에 `visibility` 가 없고,
// 그 컬럼을 만지는 유일한 경로가 여기다(재배치 센터의 최초 배치는 별개 흐름).

export const SetSurveyVisibilityInput = z.object({
  surveyId: z.uuid(),
  visibility: SurveyVisibilitySchema,
});
export type SetSurveyVisibilityInput = z.infer<typeof SetSurveyVisibilityInput>;
