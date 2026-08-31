// 워크스페이스 경계 계약 — 팀 관리 화면(.pen FLOW 7)이 경계를 건너는 모양.
// 같은 폴더의 workspace.ts — 팀 어휘(status·role·감사) SSOT. 이 파일 — 서버와 UI 사이 RPC 입출력.
// client-safe — server-only·Node·DB 의존 없음(zod 는 런타임 의존).
import * as z from 'zod';

import { fieldworkRoleValues, userStatusValues } from './auth';
import {
  fieldworkOrgStatusValues,
  surveyParticipantKindValues,
  surveyVisibilityValues,
  type SurveyGuestTabs,
  teamRoleValues,
} from './workspace';


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
  /**
   * 왜 인박스에 서 있는가 — 팀을 잃었는가(해산, 티켓 13) 소유자를 잃었는가(퇴사, 티켓 19).
   *
   * 처리자가 하는 일은 같아 목록도 하나지만(PENDING_SURVEY_WHERE) **상태 표기와 경고는
   * 갈린다**. 승계 대기 설문은 팀을 그대로 갖고 있고, 소유자 컬럼에는 떠난 사람이 남아 있어
   * 발송되는 메일의 회신이 계속 그 주소로 간다(티켓 20). 그 사실을 말하지 않으면 인박스는
   * 「나중에 해도 되는 정리 목록」으로 읽힌다.
   */
  pendingKind: z.enum(['assignment', 'succession']),
  /** 현재 소유 팀 이름. 배치 대기는 팀이 없어 null, 승계 대기는 팀을 그대로 갖는다. */
  teamName: z.string().nullable(),
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

// ─────────────────────────────────────────────────────────────────────────────
// 설문 참여자 (.pen FLOW 4-2 참여자 블록, 티켓 18)
// ─────────────────────────────────────────────────────────────────────────────
//
// 추가와 제외의 권한 축이 다르다(스펙 §7·§11-5) — 추가는 그 설문에 접근 가능한 내부인
// 누구나(`survey.invite`), 제외는 소유자·소유 팀 팀장·슈퍼어드민만(`survey.manageAccess`).
// 계약을 하나로 합치지 않는 이유가 그것이다.

const SurveyParticipantKindSchema = z.enum(surveyParticipantKindValues);

/** 공유 모달의 참여자 행 (.pen 4-2). */
export const SurveyParticipantItem = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  kind: SurveyParticipantKindSchema,
  /**
   * 소속 표기 — 내부 계정은 활성 팀 이름이 온다. 팀 미배치면 null.
   *
   * .pen 4-2 의 「부가」 줄은 팀 · 이메일 둘뿐이다. 직책은 팀 상세에서 다루는 값이라
   * 여기 싣지 않는다 — 화면이 안 그리는 필드를 계약이 나르면 죽은 채로 남는다.
   */
  teamName: z.string().nullable(),
  addedAt: z.date(),
});
export type SurveyParticipantItem = z.infer<typeof SurveyParticipantItem>;

/**
 * 참여자 목록 + **내가 제외할 수 있는가**.
 *
 * 화면이 역할을 다시 세지 않도록 서버가 답을 함께 준다 — 근사를 하나 더 만들면
 * 「목록엔 제외 버튼이 있는데 누르면 FORBIDDEN」이 생긴다.
 */
export const ListSurveyParticipantsOutput = z.object({
  participants: z.array(SurveyParticipantItem),
  canRemove: z.boolean(),
});
export type ListSurveyParticipantsOutput = z.infer<typeof ListSurveyParticipantsOutput>;

export const ListSurveyParticipantsInput = z.object({ surveyId: z.uuid() });
export type ListSurveyParticipantsInput = z.infer<typeof ListSurveyParticipantsInput>;

/**
 * 초대 후보 검색 — internal active 사용자 (팀 무관).
 *
 * 팀으로 좁히지 않는 것이 이 티켓의 요점이다. 참여자는 팀 경계를 넘고 팀 멤버십을 만들지
 * 않는다(스펙 §4). 이미 참여 중인 사람과 소유자는 후보에서 빠진다 — 목록에 있는 사람을
 * 다시 추가하는 동선은 실패밖에 없다.
 */
export const SearchParticipantCandidatesInput = z.object({
  surveyId: z.uuid(),
  query: z.string().trim().max(100),
});
export type SearchParticipantCandidatesInput = z.infer<typeof SearchParticipantCandidatesInput>;

export const ParticipantCandidateItem = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  teamName: z.string().nullable(),
});
export type ParticipantCandidateItem = z.infer<typeof ParticipantCandidateItem>;

export const SearchParticipantCandidatesOutput = z.array(ParticipantCandidateItem);
export type SearchParticipantCandidatesOutput = z.infer<typeof SearchParticipantCandidatesOutput>;

export const AddSurveyParticipantInput = z.object({
  surveyId: z.uuid(),
  userId: z.uuid(),
});
export type AddSurveyParticipantInput = z.infer<typeof AddSurveyParticipantInput>;

export const RemoveSurveyParticipantInput = AddSurveyParticipantInput;
export type RemoveSurveyParticipantInput = z.infer<typeof RemoveSurveyParticipantInput>;

// ─────────────────────────────────────────────────────────────────────────────
// 설문 게스트 부여 (.pen FLOW 4-2 클라이언트 블록, 티켓 21)
// ─────────────────────────────────────────────────────────────────────────────
//
// 참여자와 같은 테이블·같은 권한 축이지만 계약을 따로 두는 이유는 **탭 화이트리스트**다.
// 참여자에게는 없는 축이라 한 계약으로 합치면 절반이 항상 null 인 필드가 되고, 화면도
// kind 로 다시 갈라야 한다(.pen 도 블록을 나눠 그린다).

/**
 * 탭 화이트리스트의 경계 모양.
 *
 * `satisfies` 로 어휘 타입에 묶는 것이 요점이다 — 탭이 늘었을 때 한쪽만 늘면 tsc 가
 * 그 자리에서 호명한다(둘이 따로 놀면 「계약에는 있는데 검증에서 떨어지는」 키가 생긴다).
 */
const SurveyGuestTabsSchema = z.object({
  overview: z.boolean(),
  progressReport: z.boolean(),
  contactsMasked: z.boolean(),
  quota: z.boolean(),
}) satisfies z.ZodType<SurveyGuestTabs>;

/** 공유 모달의 게스트 행 (.pen 4-2 클라이언트 블록). */
export const SurveyGuestItem = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  /**
   * 소속 기관 메모 — 게스트에게는 팀이 없으므로 이 칸이 「어디 사람인가」를 말한다
   * (users.organization, 0086). 안 적힌 계정은 null 이다.
   */
  organization: z.string().nullable(),
  tabs: SurveyGuestTabsSchema,
  addedAt: z.date(),
});
export type SurveyGuestItem = z.infer<typeof SurveyGuestItem>;

/**
 * 게스트 목록 + **내가 이 부여들을 관리할 수 있는가**(해제·탭 변경).
 *
 * 참여자 목록의 `canRemove` 와 이름이 다른 이유는 잠기는 것이 둘이기 때문이다. 스펙 §11-5
 * 는 「**초대** 제거·범위 변경」을 소유자·팀장·슈퍼어드민으로 묶는데, 게스트의 탭
 * 화이트리스트가 정확히 그 「초대의 범위」다 — 추가만 접근자 누구나이고, 이미 선 부여를
 * 넓히거나 좁히는 것은 관리 행위다.
 */
export const ListSurveyGuestsOutput = z.object({
  guests: z.array(SurveyGuestItem),
  canManage: z.boolean(),
});
export type ListSurveyGuestsOutput = z.infer<typeof ListSurveyGuestsOutput>;

export const ListSurveyGuestsInput = z.object({ surveyId: z.uuid() });
export type ListSurveyGuestsInput = z.infer<typeof ListSurveyGuestsInput>;

/**
 * 부여 후보 검색 — guest active 계정.
 *
 * 모집단이 참여자 검색과 정반대다: 저쪽은 internal, 이쪽은 guest. 한 검색으로 합치면
 * 「참여자 칸에서 클라이언트가 잡히는」 화면이 되고, 그 행을 추가하면 코어가 전부 거부한다.
 */
export const SearchGuestCandidatesInput = z.object({
  surveyId: z.uuid(),
  query: z.string().trim().max(100),
});
export type SearchGuestCandidatesInput = z.infer<typeof SearchGuestCandidatesInput>;

export const GuestCandidateItem = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  organization: z.string().nullable(),
});
export type GuestCandidateItem = z.infer<typeof GuestCandidateItem>;

export const SearchGuestCandidatesOutput = z.array(GuestCandidateItem);
export type SearchGuestCandidatesOutput = z.infer<typeof SearchGuestCandidatesOutput>;

/**
 * 부여 추가 — 탭은 받지 않는다.
 *
 * 새 부여는 언제나 기본값(응답 현황만)으로 선다. 추가와 동시에 탭을 넘기게 두면 화면이
 * 「추가 → 체크」 두 단계인데 계약은 한 단계라 두 경로가 생기고, 기본값의 정본도 둘이 된다.
 */
export const AddSurveyGuestInput = z.object({
  surveyId: z.uuid(),
  userId: z.uuid(),
});
export type AddSurveyGuestInput = z.infer<typeof AddSurveyGuestInput>;

/**
 * 탭 화이트리스트 저장 — **네 값을 통째로** 받는다. 관문은 `survey.manageAccess` 다.
 *
 * 부분 갱신(`{quota: true}`)을 받지 않는 것이 의도다. 체크박스 넷은 한 화면에서 함께
 * 보이므로 통째로 보내는 것이 화면과 같은 단위이고, 부분 갱신을 열면 나중에 탭이 늘었을 때
 * 「안 보낸 키는 유지」와 「안 보낸 키는 false」 중 무엇인지가 호출부마다 갈린다.
 */
export const SetSurveyGuestTabsInput = z.object({
  surveyId: z.uuid(),
  userId: z.uuid(),
  tabs: SurveyGuestTabsSchema,
});
export type SetSurveyGuestTabsInput = z.infer<typeof SetSurveyGuestTabsInput>;

export const RemoveSurveyGuestInput = AddSurveyGuestInput;
export type RemoveSurveyGuestInput = z.infer<typeof RemoveSurveyGuestInput>;

// ─────────────────────────────────────────────────────────────────────────────
// 게스트 홈 — 부여 설문 카드 (.pen FLOW 5-2, 티켓 22)
// ─────────────────────────────────────────────────────────────────────────────
//
// RPC 가 아니라 **RSC 가 props 로 넘기는 read model 행**이라 zod 가 아니라 인터페이스다
// (survey-builder-io 의 SurveyListItem 과 같은 부류).

/**
 * 카드에 찍히는 설문의 진행 상태.
 *
 * 문자열 라벨이 아니라 판별자를 넘기는 것이 요점이다 — 「진행중」·「종료」는 화면 문구이고,
 * 서버가 그것을 만들어 보내면 같은 뜻이 두 자리에서 다르게 번역된다.
 */
export type GuestSurveyLifecycle = 'draft' | 'running' | 'paused' | 'closed';

/** 게스트 홈의 설문 카드 한 줄. */
export interface GuestSurveyCardRow {
  surveyId: string;
  title: string;
  /** 현재 배포 버전의 발행 시각 — 기간의 시작. 미발행이면 null. */
  publishedAt: Date | null;
  /** 마감일 — 기간의 끝. 없으면 「마감일 없음」. */
  endDate: Date | null;
  lifecycle: GuestSurveyLifecycle;
  /** 이 설문에서 이 게스트에게 열린 현황 탭. */
  tabs: SurveyGuestTabs;
}

// ─────────────────────────────────────────────────────────────────────────────
// 게스트 「조사 대상 (마스킹)」 탭 — 서버에서 끝낸 투영 (티켓 22)
// ─────────────────────────────────────────────────────────────────────────────
//
// 운영 콘솔의 행(`ContactsRow`)을 그대로 쓰지 않는다. 그 행에는 `inviteToken`(그 사람의
// 응답 링크)과 컨택 id 가 실려 있어, 게스트에게 가면 열람이 대리 응답이 된다.
// **화면이 무엇을 안 그리는가가 아니라 무엇이 오지 않는가가 계약이다.**

/** 표 한 줄 — 표시 문자열만. 값이 없으면 null 이고 화면이 「—」로 그린다. */
export interface GuestContactRow {
  resid: number;
  cells: (string | null)[];
}

export interface GuestContactsPage {
  /** 표 머리 — 스킴이 정한 라벨뿐이다(정렬·필터가 없어 source 키가 필요 없다). */
  columns: string[];
  rows: GuestContactRow[];
  total: number;
  page: number;
  pageSize: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 소유권 이전 · 승계 (.pen FLOW 4-4·9-3, 티켓 19)
// ─────────────────────────────────────────────────────────────────────────────
//
// 두 입구가 같은 이동을 만든다 — 공유 모달의 수동 이전과 퇴사 처리의 승계. 계약을 나누되
// 실행은 한 서비스로 모은다: 「소유자가 바뀐다」는 사실의 불변식(소유자는 소유 팀 사람이어야
// 한다, 그룹은 팀을 따라간다)이 두 벌이 되면 한쪽만 조여진다.

export const TransferSurveyOwnershipInput = z.object({
  surveyId: z.uuid(),
  newOwnerUserId: z.uuid(),
  /**
   * 화면이 보고 있던 소유자 — **낙관적 동시성 토큰**이다(티켓 19).
   *
   * `FOR UPDATE` 는 직렬화만 한다. 서로 다른 후임을 지목한 두 요청은 순서대로 들어가 **둘 다
   * 성공하고 나중 것이 이긴다** — 「현재 소유자: 김연구」를 보고 누른 요청이 이미 박도윤으로
   * 바뀐 위에 그대로 얹힌다. 기대 소유자를 함께 보내면 잠긴 값과 대조해 뒤늦은 요청을 거부할
   * 수 있다(티켓 체크박스 「동시 요청 중 하나만 성공」).
   *
   * 소유자를 모르는 옛 설문(0089 2단계 배포)은 null 을 보낸다.
   */
  expectedOwnerUserId: z.uuid().nullable(),
});
export type TransferSurveyOwnershipInput = z.infer<typeof TransferSurveyOwnershipInput>;

/**
 * 이전 후보 한 명 (.pen 4-4 「새 소유자」 드롭다운).
 *
 * 후보 모집단은 **같은 팀 active 멤버 + 이 설문 참여자**다(스펙 §4). `source` 를 함께 주는
 * 이유는 화면이 「박도윤 · 연구1본부 - 1팀」과 「정분석 · 참여자」를 갈라 적기 때문이다.
 */
export const TransferCandidateItem = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  teamName: z.string().nullable(),
  source: z.enum(['team_member', 'participant']),
});
export type TransferCandidateItem = z.infer<typeof TransferCandidateItem>;

export const ListTransferCandidatesOutput = z.array(TransferCandidateItem);
export type ListTransferCandidatesOutput = z.infer<typeof ListTransferCandidatesOutput>;

/**
 * 퇴사 처리 화면이 미리 보는 설문 한 건 (.pen 9-3).
 *
 * `proposedUserId` 가 null 이면 **승계 대기**로 간다는 뜻이다 — 「후보가 없다」와 「아직 안
 * 정했다」를 화면이 갈라야 하므로 null 을 그대로 노출한다.
 */
export const SuccessionPlanItem = z.object({
  surveyId: z.uuid(),
  title: z.string(),
  teamName: z.string().nullable(),
  proposedUserId: z.uuid().nullable(),
  proposedName: z.string().nullable(),
  /** 왜 이 사람이 제안됐는가 — 화면이 「참여자 (가장 먼저 초대됨)」/「팀장」으로 적는다. */
  proposedReason: z.enum(['participant', 'team_leader']).nullable(),
  /** 이 설문에서 고를 수 있는 후임 전체 — 처리자가 제안을 바꿀 수 있어야 한다. */
  candidates: z.array(TransferCandidateItem),
});
export type SuccessionPlanItem = z.infer<typeof SuccessionPlanItem>;

export const SuccessionPreviewInput = z.object({ userId: z.uuid() });
export type SuccessionPreviewInput = z.infer<typeof SuccessionPreviewInput>;

export const SuccessionPreviewOutput = z.object({ surveys: z.array(SuccessionPlanItem) });
export type SuccessionPreviewOutput = z.infer<typeof SuccessionPreviewOutput>;

/**
 * 퇴사 처리와 함께 확정하는 승계 지정.
 *
 * `newOwnerUserId: null` 은 **승계 대기로 보낸다**는 명시적 선택이다 — 목록에서 빠뜨린 것과
 * 구별해야 해서 설문 id 를 반드시 적게 한다. 서버는 소유 설문 전수가 이 목록에 있는지
 * 확인하고, 빠진 것이 있으면 거부한다(조용히 승계 대기로 흘려보내지 않는다).
 */
export const SuccessionAssignment = z.object({
  surveyId: z.uuid(),
  newOwnerUserId: z.uuid().nullable(),
});
export type SuccessionAssignment = z.infer<typeof SuccessionAssignment>;

// ─────────────────────────────────────────────────────────────────────────────
// 실사 업체 관리 (.pen FLOW 10-4, 티켓 24)
// ─────────────────────────────────────────────────────────────────────────────
//
// 사용자 관리의 하위 탭이라 화면은 auth 쪽 표면과 나란히 서지만, 엔티티는 워크스페이스
// 소관이다 — 팀과 같은 「소속 경계」 계열이고 관리 축도 슈퍼어드민으로 같다.

/** 업체 이름. 활성 업체 안에서 유일하다(fieldwork_orgs_active_name_uq). */
const FieldworkOrgNameField = z.string().trim().min(1, '업체 이름을 입력하세요.').max(100);

/** 운영 메모 — 비우고 보낼 수 있다. 공백만 남은 값은 미입력으로 접는다(자유 입력 관례). */
const FieldworkOrgMemoField = z
  .string()
  .trim()
  .max(200)
  .transform((value) => (value ? value : null))
  .nullable()
  .default(null);

/** 업체 카드가 펼쳐 보여주는 소속 계정 한 줄 (.pen 10-4 계정 행). */
export const FieldworkOrgAccountItem = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  fieldworkRole: z.enum(fieldworkRoleValues),
  status: z.enum(userStatusValues),
});
export type FieldworkOrgAccountItem = z.infer<typeof FieldworkOrgAccountItem>;

/**
 * 업체 카드 한 장.
 *
 * 계정 목록을 **행에 실어 함께 준다** — 협력 업체는 ~5곳이고 카드가 펼쳐지면 바로 명단을
 * 그리므로(.pen 10-4), 카드마다 두 번째 왕복을 만들 이유가 없다.
 */
export const FieldworkOrgListItem = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(fieldworkOrgStatusValues),
  memo: z.string().nullable(),
  /** 재직 중 계정만 센다 — 카드 부제의 「팀장 1 · 실사원 3」이 이 값이다. */
  leaderCount: z.number().int(),
  workerCount: z.number().int(),
  /**
   * 이 업체 소속원이 초대된 설문 수 (.pen 「초대된 설문 4건」).
   *
   * 초대는 개인 단위지만 카드가 세는 것은 **업체 단위 distinct 설문**이다 — 한 설문에 두
   * 사람이 초대돼 있어도 1건이다. 초대 표면은 티켓 25 라 지금은 늘 0 이지만, 자리를 지금
   * 두는 편이 낫다(나중에 넣으면 카드 레이아웃이 한 번 더 바뀐다).
   */
  invitedSurveyCount: z.number().int(),
  accounts: z.array(FieldworkOrgAccountItem),
});
export type FieldworkOrgListItem = z.infer<typeof FieldworkOrgListItem>;

/** 목록 — 활성 업체만. archived 는 계보로 남을 뿐 화면에 서지 않는다. */
export const ListFieldworkOrgsOutput = z.object({
  orgs: z.array(FieldworkOrgListItem),
});
export type ListFieldworkOrgsOutput = z.infer<typeof ListFieldworkOrgsOutput>;

export const CreateFieldworkOrgInput = z.object({
  name: FieldworkOrgNameField,
  memo: FieldworkOrgMemoField,
});
export type CreateFieldworkOrgInput = z.infer<typeof CreateFieldworkOrgInput>;

export const CreateFieldworkOrgOutput = z.object({ id: z.uuid() });
export type CreateFieldworkOrgOutput = z.infer<typeof CreateFieldworkOrgOutput>;

export const UpdateFieldworkOrgInput = z.object({
  orgId: z.uuid(),
  name: FieldworkOrgNameField,
  memo: FieldworkOrgMemoField,
});
export type UpdateFieldworkOrgInput = z.infer<typeof UpdateFieldworkOrgInput>;

/**
 * 업체 종료 — 이름 확인 문구가 **없다**(팀 해산과 다른 점).
 *
 * 해산은 소속 설문 전부를 배치 대기로 밀어내지만 업체 종료는 아무것도 움직이지 않는다.
 * 대신 서버가 **재직 중 계정이 하나도 없을 것**을 요구한다 — 실사 계정에는 「미배치」에
 * 해당하는 상태가 없어(user_type=fieldwork 면 소속이 NOT NULL 이다) 종료된 업체의 재직
 * 계정은 정의되지 않은 상태로 계속 로그인한다. 먼저 계정을 정리하게 하는 편이 정직하다.
 */
export const ArchiveFieldworkOrgInput = z.object({ orgId: z.uuid() });
export type ArchiveFieldworkOrgInput = z.infer<typeof ArchiveFieldworkOrgInput>;

/** 계정 발급 모달의 소속 업체 셀렉트가 쓰는 최소 모양 — 활성 업체만. */
export const FieldworkOrgOption = z.object({ id: z.uuid(), name: z.string() });
export type FieldworkOrgOption = z.infer<typeof FieldworkOrgOption>;

export const ListFieldworkOrgOptionsOutput = z.array(FieldworkOrgOption);
export type ListFieldworkOrgOptionsOutput = z.infer<typeof ListFieldworkOrgOptionsOutput>;

// ─────────────────────────────────────────────────────────────────────────────
// 실사 초대 (.pen FLOW 4-2 실사 블록, 티켓 25)
// ─────────────────────────────────────────────────────────────────────────────
//
// **초대는 개인 단위다**(ADR-0019) — 업체 단위 초대 + 업체 측 배정 UI 는 MVP 무게 때문에
// 기각했다. 내부가 공유 설정에서 「이 설문은 누가 뛴다」를 직접 지정한다. 실사 팀장의
// 업체 시야는 초대가 아니라 **파생**이라 여기 행이 생기지 않는다.

/** 실사 블록의 한 줄 — 업체명이 함께 온다(.pen 「그린리서치 · hwpark@…」). */
export const SurveyFieldworkItem = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  /** 소속 업체 이름 — 같은 이름이 여럿일 수 있어 사람 구분의 핵심 정보다. */
  orgName: z.string(),
  fieldworkRole: z.enum(fieldworkRoleValues),
  addedAt: z.date(),
});
export type SurveyFieldworkItem = z.infer<typeof SurveyFieldworkItem>;

export const ListSurveyFieldworkInput = z.object({ surveyId: z.uuid() });
export type ListSurveyFieldworkInput = z.infer<typeof ListSurveyFieldworkInput>;

/**
 * 목록 + 내가 이 초대들을 해제할 수 있는가.
 *
 * 판정은 참여자·게스트 블록과 **같은 술어**(`survey.manageAccess`)다 — 제외 권한이 초대
 * 종류마다 갈리면 한 모달 안에서 규칙이 세 벌이 된다.
 */
export const ListSurveyFieldworkOutput = z.object({
  members: z.array(SurveyFieldworkItem),
  canManage: z.boolean(),
});
export type ListSurveyFieldworkOutput = z.infer<typeof ListSurveyFieldworkOutput>;

export const SearchFieldworkCandidatesInput = z.object({
  surveyId: z.uuid(),
  query: z.string().trim().max(100).default(''),
});
export type SearchFieldworkCandidatesInput = z.infer<typeof SearchFieldworkCandidatesInput>;

export const FieldworkCandidateItem = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  orgName: z.string(),
  fieldworkRole: z.enum(fieldworkRoleValues),
});
export type FieldworkCandidateItem = z.infer<typeof FieldworkCandidateItem>;

export const SearchFieldworkCandidatesOutput = z.array(FieldworkCandidateItem);
export type SearchFieldworkCandidatesOutput = z.infer<typeof SearchFieldworkCandidatesOutput>;

export const AddSurveyFieldworkInput = z.object({ surveyId: z.uuid(), userId: z.uuid() });
export type AddSurveyFieldworkInput = z.infer<typeof AddSurveyFieldworkInput>;

export const RemoveSurveyFieldworkInput = z.object({ surveyId: z.uuid(), userId: z.uuid() });
export type RemoveSurveyFieldworkInput = z.infer<typeof RemoveSurveyFieldworkInput>;

// ─────────────────────────────────────────────────────────────────────────────
// 실사 홈 (.pen FLOW 10-1, 티켓 25)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 실사 홈의 범위 세그먼트.
 *
 * 실사원에게는 세그먼트 자체가 없다(초대뿐) — 값이 둘인 것은 팀장 화면의 사정이고,
 * 서버는 요청한 범위를 역할로 다시 검증한다(화면 값은 언제나 편의다).
 */
export const fieldworkHomeScopeValues = ['invited', 'org'] as const;
export type FieldworkHomeScope = (typeof fieldworkHomeScopeValues)[number];

/** 홈 목록 한 줄 (.pen 10-1 표). */
export const FieldworkHomeSurveyItem = z.object({
  surveyId: z.uuid(),
  title: z.string(),
  /** 소유 팀 이름 — 배치 대기 설문은 홈에 오지 않으므로 언제나 있다. */
  teamName: z.string().nullable(),
  /** 소유자 이름 — 초대 행에는 「소유 김새로」, 업체 시야 행에는 초대받은 소속원 이름을 쓴다. */
  ownerName: z.string().nullable(),
  /**
   * 이 줄이 왜 보이는가 — `invited`(내가 초대됨) / `org`(소속원이 초대됨).
   *
   * 화면의 「초대됨」·「업체 시야」 필이 이 값이고, 액션도 갈린다(조사 대상 / 열람).
   * 화면이 세그먼트로 추론하지 않는 이유는 「업체 전체」에 두 종류가 섞여 있어서다.
   */
  reason: z.enum(fieldworkHomeScopeValues),
  /** 업체 시야 줄에서 이 설문에 초대된 소속원 이름 — 내 초대 줄에서는 null. */
  invitedColleagueName: z.string().nullable(),
  completedCount: z.number().int(),
  /** 쿼터 목표 총합. 쿼터가 없으면 null — 화면은 「117 / —」로 그린다. */
  targetCount: z.number().int().nullable(),
  lastActivityAt: z.date().nullable(),
});
export type FieldworkHomeSurveyItem = z.infer<typeof FieldworkHomeSurveyItem>;

// ─────────────────────────────────────────────────────────────────────────────
// 실사 조사 대상 (.pen FLOW 10-2, 티켓 26)
// ─────────────────────────────────────────────────────────────────────────────
//
// **원본 전체**를 본다 — 게스트의 마스킹본과 정반대다(스펙 §6, 결정 2026-08-25).
// 대리 실사라는 업무가 연락처를 전제하므로 암호화 PII 를 복호해 보여주고, 대신 접근이
// 초대된 설문 하나로 한정된다. 그래서 이 모양에는 `inviteToken` 이 실려 있다 —
// 게스트 행에서 그것을 뺀 이유(열람이 대리 응답이 된다)가 여기서는 **목적**이다.

/** 표 헤더 한 칸 — 라벨만 건넌다(소스 문자열은 서버에 남는다). */
export const FieldworkContactColumn = z.object({ key: z.string(), label: z.string() });
export type FieldworkContactColumn = z.infer<typeof FieldworkContactColumn>;

export const FieldworkContactRow = z.object({
  contactTargetId: z.uuid(),
  resid: z.number().int(),
  /** 컬럼 순서대로의 표시 문자열 — PII 는 **복호된 원문**이다. */
  cells: z.array(z.string().nullable()),
  groupValue: z.string().nullable(),
  latestResultCode: z.string().nullable(),
  /** 시도 횟수 — 회차가 없으면 0(.pen 「시도」 열). */
  attemptCount: z.number().int(),
  /** 매칭 응답의 status. 없으면 null — 화면이 「미응답」으로 그린다. */
  responseStatus: z.string().nullable(),
  /**
   * 대행 진입에 쓰는 초대 토큰 (.pen 「응답 대행」).
   *
   * 귀속 기록(fieldworkUserId)은 티켓 27 이 붙인다 — 이 티켓은 링크까지다.
   */
  inviteToken: z.string(),
});
export type FieldworkContactRow = z.infer<typeof FieldworkContactRow>;

export const FieldworkContactsPage = z.object({
  columns: z.array(FieldworkContactColumn),
  rows: z.array(FieldworkContactRow),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  /** 그룹 드롭다운의 선택지 — 이 설문에 실제로 있는 값만. */
  groups: z.array(z.string()),
  /** 결과코드 드롭다운의 선택지 — 설문이 정의한 어휘. */
  resultCodes: z.array(z.string()),
  /** 진척 배지 「완료 117 / 전체 142」 — 필터와 무관한 설문 전체 수다. */
  progress: z.object({ completed: z.number().int(), total: z.number().int() }),
});
export type FieldworkContactsPage = z.infer<typeof FieldworkContactsPage>;
