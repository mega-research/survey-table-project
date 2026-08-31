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
  /**
   * 해산 시점의 규모 — 팀원 수와 배치 대기로 넘어간 설문 수 (티켓 13).
   *
   * 트랜잭션 **안에서** 잰 값이다. 화면이 확인 모달에 보여준 숫자는 그 사이 바뀔 수 있으므로
   * 기록에 남는 것은 이쪽이다. team_members 행은 감사용으로 남지만 설문은 teamId 를 잃어
   * 사후에 "그때 몇 건이었나" 를 되짚을 방법이 없다.
   */
  memberCount?: number;
  surveyCount?: number;
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

// ─────────────────────────────────────────────────────────────────────────────
// fieldwork_orgs.status — 실사 업체 수명 (SSOT, 티켓 24)
// ─────────────────────────────────────────────────────────────────────────────
//
// 업체는 **워크스페이스가 아니다**(ADR-0019) — 설문을 소유하지 않고 팀 멤버십을 만들지
// 않으며 재배치 목적지가 될 수 없다. 이름·상태만 갖는 가벼운 경계 엔티티이고, 하는 일은
// 「이 실사 계정이 어느 업체 사람인가」 하나뿐이다. 그 경계가 없으면 실사 팀장의 파생
// 시야(티켓 25)가 타 업체 설문까지 넘친다.
//
// 종료도 팀과 같은 판단이다 — 행을 지우지 않고 archived 로 내린다. 소속 계정이 계보로
// 남아 있어야 「누가 어느 업체 사람이었는가」를 되짚을 수 있다.

export const fieldworkOrgStatusValues = ['active', 'archived'] as const;
export type FieldworkOrgStatus = (typeof fieldworkOrgStatusValues)[number];

/**
 * 실사 업체를 관리할 수 있는가 — 슈퍼어드민만 (스펙 §6).
 *
 * 팀장에게도, **실사 팀장에게도** 열지 않는다. 업체 목록은 협력사 명부라 한 업체 사람에게
 * 열면 경쟁 업체의 존재와 인원이 그대로 드러난다. `canManageTeamSettings` 와 판정이 같지만
 * 이유가 달라(저쪽은 조직도, 이쪽은 협력사 명부) 별개 술어로 둔다 — 한쪽을 넓힐 때 다른
 * 쪽이 조용히 따라가면 안 된다.
 */
export function canManageFieldworkOrgs(actor: { isSuperadmin: boolean }): boolean {
  return actor.isSuperadmin;
}

// ─────────────────────────────────────────────────────────────────────────────
// surveys.visibility — 설문 공개 범위 (SSOT, 티켓 07)
// ─────────────────────────────────────────────────────────────────────────────
//
// v2 에서 invite_only 의 뜻이 바뀌었다(스펙 §3) — "소유 팀 **팀원에게만** 숨김"이다.
// 소유자·참여자·소유 팀 팀장·슈퍼어드민은 팀 공개와 완전히 같게 동작한다. v1 처럼
// 팀장까지 막으면 팀장이 자기 팀 설문을 관리할 수 없어 승계·해산이 잠긴다.

export const surveyVisibilityValues = ['team', 'invite_only'] as const;
export type SurveyVisibility = (typeof surveyVisibilityValues)[number];

/**
 * 화면 표기 (.pen FLOW 4-2 세그먼트, 티켓 16) — `TEAM_ROLE_LABEL` 과 같은 자리에 둔다.
 *
 * 여기가 SSOT 인 이유는 이 어휘를 그리는 화면이 서로 다른 feature 묶음에 흩어져 있어서다
 * (공유 설정은 survey-builder, 재배치 센터는 workspace — 둘은 서로 import 할 수 없다).
 * 실제로 재배치 센터가 `team` 을 「팀 전체」로 적어, 같은 컬럼이 화면마다 다른 말로 보였다.
 * 「팀 전체」는 시스템 전체 보기(메가리서치)와 헷갈리므로 쓰지 않는다.
 */
export const SURVEY_VISIBILITY_LABEL: Record<SurveyVisibility, string> = {
  team: '팀 공개',
  invite_only: '초대된 멤버만',
};

// ─────────────────────────────────────────────────────────────────────────────
// survey_participants.kind — 설문 단위 부여의 종류 (SSOT, 티켓 18)
// ─────────────────────────────────────────────────────────────────────────────
//
// 한 테이블에 셋을 담는 이유는 **설문 단위 부여**라는 한 가지 사실을 말하기 때문이다
// (스펙 §9). 저장소를 셋으로 나누면 「이 설문에 누가 초대돼 있는가」를 묻는 데 세 번
// 조인해야 하고, 공유 모달 한 화면이 그 셋을 한꺼번에 그린다.
//
// - member    참여자(internal) — 티켓 18. 열람·편집·운영·삭제까지, 발행·공유 관리·이전 제외.
// - guest     클라이언트 계정 — 티켓 21 이 실제 판정을 붙인다(탭 화이트리스트는 guestTabs).
// - fieldwork 실사 계정 — 티켓 24~27.
//
// **kind 와 users.userType 의 정합은 서비스가 지킨다**(스펙 §9). DB CHECK 로 못 거는 이유는
// 두 테이블에 걸친 조건이라서다 — guest 계정을 member 로 초대하면 capability 코어의 계정
// 유형 게이트가 어차피 전부 거부하지만, 그 전에 입구에서 막아야 「추가됐는데 아무것도 안
// 되는」 유령 행이 안 생긴다.

export const surveyParticipantKindValues = ['member', 'guest', 'fieldwork'] as const;
export type SurveyParticipantKind = (typeof surveyParticipantKindValues)[number];

/** 화면 표기 — .pen FLOW 4-2 의 필 라벨. */
export const SURVEY_PARTICIPANT_KIND_LABEL: Record<SurveyParticipantKind, string> = {
  member: '참여자',
  guest: '게스트',
  fieldwork: '실사원',
};

/**
 * 게스트에게 열리는 현황 탭 화이트리스트 (kind='guest' 전용, 티켓 21).
 *
 * 어휘가 컬럼과 같은 자리에 사는 이유는 `survey_participants.guest_tabs` 가 이 모양을
 * `$type<>` 로 참조하기 때문이다 — JSONB 라 마이그레이션은 없어도 읽는 쪽 정규화가 두 벌이
 * 되면 「체크는 했는데 안 열리는」 탭이 생긴다(스펙 §5, .pen 4-2 칩 4종).
 *
 * 메일 탭은 **선택지에 없다** — 게스트에게 항상 차단이라 어휘에 넣으면 화면이 체크박스를
 * 그릴 수 있게 된다. 열 수 없는 것은 어휘에도 없다.
 */
export interface SurveyGuestTabs {
  overview: boolean;
  progressReport: boolean;
  contactsMasked: boolean;
  quota: boolean;
}

/** 체크박스 순서의 정본 — .pen 4-2 의 칩 4종. */
export const surveyGuestTabValues = [
  'overview',
  'progressReport',
  'contactsMasked',
  'quota',
] as const;
export type SurveyGuestTab = (typeof surveyGuestTabValues)[number];

/** 화면 표기 — 어휘와 문구를 한 자리에서 잇는다(TEAM_ROLE_LABEL 과 같은 규약). */
export const SURVEY_GUEST_TAB_LABEL: Record<SurveyGuestTab, string> = {
  overview: '응답 현황',
  progressReport: '진척 보고',
  contactsMasked: '조사 대상 (마스킹)',
  quota: '쿼터 현황',
};

/**
 * 부여 직후의 기본값 — **응답 현황 하나뿐**이다(스펙 §5 표).
 *
 * 전부 켠 채로 시작하지 않는 것이 요점이다. 클라이언트에게 열어 줄 것은 담당 연구원이
 * 매번 고르는 값이지, 빼는 것을 잊으면 새는 값이 아니다.
 */
export const DEFAULT_SURVEY_GUEST_TABS: SurveyGuestTabs = {
  overview: true,
  progressReport: false,
  contactsMasked: false,
  quota: false,
};

/** 아무 탭도 열리지 않은 상태 — 부여가 없는 주체의 판정 결과. */
export const NO_SURVEY_GUEST_TABS: SurveyGuestTabs = {
  overview: false,
  progressReport: false,
  contactsMasked: false,
  quota: false,
};

/**
 * JSONB 컬럼 값 → 탭 화이트리스트 (로더 정규화, 드리프트 흡수).
 *
 * 두 방향을 각각 다르게 접는다.
 *  - **컬럼이 비어 있으면**(NULL·비객체) 기본값이다. kind='guest' 행은 언제나 네 키를 다
 *    쓰고 들어오므로, 비어 있는 것은 옛 행이거나 손으로 넣은 행이다 — 그 경우의 계약은
 *    「기본은 응답 현황만」이다.
 *  - **객체인데 키가 없으면 false** 다. 나중에 탭을 늘렸을 때 옛 행이 새 탭을 자동으로
 *    얻으면 안 된다 — 부여는 늘 명시여야 한다.
 *
 * 호출부가 `?.` 로 덧대지 않도록 여기서 한 번에 정규화한다(JSONB 드리프트 관례).
 */
export function normalizeSurveyGuestTabs(raw: unknown): SurveyGuestTabs {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_SURVEY_GUEST_TABS };
  }
  const source = raw as Record<string, unknown>;
  const tabs = { ...NO_SURVEY_GUEST_TABS };
  for (const tab of surveyGuestTabValues) tabs[tab] = source[tab] === true;
  return tabs;
}

/**
 * 참여자를 **제외**할 수 있는가 — 화면과 서버가 함께 보는 술어 (스펙 §7·§11-5).
 *
 * 추가는 접근 가능한 내부인 누구나 할 수 있지만 제외는 소유자·소유 팀 팀장·슈퍼어드민뿐이다.
 * capability 로 물으면 `survey.manageAccess` 가 정확히 그 셋이라 여기서 역할을 다시 세지
 * 않는다 — 화면이 자기 표를 따로 들면 「목록엔 제외 버튼이 있는데 누르면 FORBIDDEN」이 된다.
 */
export function canRemoveSurveyParticipant(capabilities: ReadonlySet<SurveyCapability>): boolean {
  return capabilities.has('survey.manageAccess');
}

// ─────────────────────────────────────────────────────────────────────────────
// surveys.assignment_status — 팀 배치 상태 (SSOT, 티켓 07)
// ─────────────────────────────────────────────────────────────────────────────
//
// 가짜 기본 팀을 만들지 않기 위한 어휘다(ADR-0006). 팀 도입 이전 설문과 해산으로 팀을
// 잃은 설문은 team_id 가 NULL 인 채 assignment_pending 으로 서고, 재배치 센터(티켓 14)가
// 팀을 정해줄 때까지 슈퍼어드민 외에는 아무도 접근할 수 없다.
//
// DB CHECK 가 team_id 와의 정합을 강제한다 — assigned ↔ team_id NOT NULL,
// assignment_pending ↔ team_id NULL. 둘 중 하나만 바꾸는 쓰기는 DB 가 거부한다.

export const surveyAssignmentStatusValues = ['assigned', 'assignment_pending'] as const;
export type SurveyAssignmentStatus = (typeof surveyAssignmentStatusValues)[number];

// ─────────────────────────────────────────────────────────────────────────────
// surveys.ownership_status — 소유권 상태 (SSOT, 티켓 07)
// ─────────────────────────────────────────────────────────────────────────────
//
// succession_pending 은 소유자가 떠났는데 후임 후보가 없어 승계가 멈춘 상태다(스펙 §4).
// 어휘를 지금 두는 이유는 CHECK 제약이 값을 알고 있어야 해서다 — 나중에 값을 늘리려면
// 마이그레이션이 또 필요하다. 실제 전이는 티켓 19 가 붙인다.

export const surveyOwnershipStatusValues = ['normal', 'succession_pending'] as const;
export type SurveyOwnershipStatus = (typeof surveyOwnershipStatusValues)[number];

// ─────────────────────────────────────────────────────────────────────────────
// survey_ownership_events — 설문 소유 이동 감사 어휘 (SSOT, 티켓 14)
// ─────────────────────────────────────────────────────────────────────────────
//
// unassign  팀을 잃었다 (해산). 이 행이 없으면 배치 대기 설문의 **출신 팀**을 되짚을 수
//           없다 — 해산이 surveys.team_id 를 NULL 로 내리기 때문이다.
// assign    배치 대기 → 팀 배치 (재배치 센터).
// transfer  이미 배치된 설문의 팀·소유자 이동 (티켓 19 승계·수동 이전).

export const surveyOwnershipActionValues = ['unassign', 'assign', 'transfer'] as const;
export type SurveyOwnershipAction = (typeof surveyOwnershipActionValues)[number];

/**
 * 감사 행의 부수 정보 — 사건 시점 값의 사본.
 *
 * 팀 이름을 함께 적는 이유는 team_lifecycle_events 와 같다: 나중에 조인하면 **지금** 이름만
 * 보인다. 해산된 팀은 이름을 재사용할 수 있으므로(활성 팀 부분 UNIQUE) 더욱 그렇다.
 */
export interface SurveyOwnershipEventMetadata {
  surveyTitle?: string;
  fromTeamName?: string;
  toTeamName?: string;
  fromVisibility?: SurveyVisibility;
  toVisibility?: SurveyVisibility;
}

// ─────────────────────────────────────────────────────────────────────────────
// 설문 capability — 권한 판정의 최소 단위 (SSOT, 스펙 §8)
// ─────────────────────────────────────────────────────────────────────────────
//
// 역할 이름으로 분기하지 않고 언제나 capability 로 묻는다. 역할은 프리셋일 뿐이라
// 화면과 서버가 각자 "팀장이면" 같은 조건을 쓰기 시작하면 매트릭스가 두 벌이 된다.
//
// 여기 없는 것: team.manageMembers·dissolve·reassign·system.admin. 그것들은 설문이
// 아니라 팀·시스템 축이라 이 집합에 섞지 않는다 — 판정은 canManageTeamMembers·
// canManageTeamSettings(위)와 superadmin 베이스가 한다.

export const surveyCapabilityValues = [
  'survey.view',
  'survey.edit',
  'survey.publish',
  /** soft delete — 참여자까지 갖는 권한이라 복구 경로(티켓 17)가 전제다. */
  'survey.delete',
  /** 참여자·게스트·실사를 **추가**. 접근 가능한 내부인이면 누구나 할 수 있다(스펙 §4). */
  'survey.invite',
  /** 제외·공개 범위 변경·게스트/실사 부여 해제 — 스펙 §8 의 한 행이라 하나로 둔다. */
  'survey.manageAccess',
  'survey.transferOwnership',
  'operations.view',
  'responses.view',
  'contacts.view',
  'contacts.manage',
  /** 결과코드·메모 쓰기 — 실사원도 갖는 유일한 쓰기라 contacts.manage 와 가른다. */
  'contacts.writeAttempts',
  'mail.view',
  'mail.send',
  'analytics.view',
  'export.download',
  'surveyGroup.manage',
] as const;
export type SurveyCapability = (typeof surveyCapabilityValues)[number];

// ─────────────────────────────────────────────────────────────────────────────
// 작업 범위 — 지금 보고 있는 워크스페이스 (SSOT, 티켓 07)
// ─────────────────────────────────────────────────────────────────────────────
//
// 화면은 이 값을 쿠키·URL 로 기억하지만(티켓 08 팀 스위처) 그건 편의일 뿐이다 — 실제 범위는
// 서버가 멤버십을 다시 읽어 정한다(server/work-scope.ts). 여기 두는 것은 모양뿐이다.

export type WorkScope =
  | { kind: 'team'; teamId: string }
  /** 메가리서치 — 전 팀 + 배치 대기까지 보는 슈퍼어드민의 가상 범위(ADR-0006). */
  | { kind: 'system' }
  /** 볼 수 있는 범위가 없다 — 팀 미배치 내부 사용자, 그리고 게스트·실사. */
  | { kind: 'none' };

/** 시스템 전체 보기를 지목하는 예약어. teams 에 행이 없으므로 teamId 와 섞이지 않는다. */
export const SYSTEM_SCOPE = 'system';

/** 시스템 전체 보기의 표시 이름 — 팀이 아니라 슈퍼어드민의 가상 범위다(ADR-0006). */
export const SYSTEM_SCOPE_LABEL = '메가리서치';

/**
 * 마지막으로 고른 범위를 담는 쿠키 이름.
 *
 * 브라우저가 쓰고(shared/lib/work-scope-cookie) 서버가 읽는다(server/work-scope). 이름이
 * 두 벌이 되면 화면은 바꿨다고 믿고 서버는 못 읽는 조용한 어긋남이 된다.
 */
export const WORK_SCOPE_COOKIE = 'work_scope';
