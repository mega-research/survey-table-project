// 설문 카드 버튼 노출 근사 — 순수 판정 (역할 모델 v2 티켓 08·16).
import type { SurveyVisibility, WorkScope } from '@/shared/contracts/workspace';

/** 판정에 필요한 목록 아이템 최소 필드. */
export interface SurveyCardCapabilitySubject {
  ownerUserId: string | null;
  visibility: SurveyVisibility;
  teamId: string | null;
  /**
   * 내가 이 설문의 참여자인가 (티켓 18).
   *
   * 참여는 **팀 축 밖**이라 scope·teamId 로는 알 수 없다 — 목록이 행마다 실어 보낸다.
   * 이 값이 근사 셋을 처음으로 갈라놓는다: 참여자는 편집·분석은 되고 공개 범위는 안 된다.
   */
  isParticipant: boolean;
}

/**
 * 지금 목록을 보고 있는 사람 — 세 근사가 공통으로 묻는 것.
 *
 * 넷을 낱개 인자로 흘리면 근사를 하나 더할 때마다 시그니처가 늘고(티켓 16 이 세 번째였다)
 * 티켓 18 이 참여 행을 얹을 때 세 함수와 모든 호출부를 한꺼번에 고쳐야 한다. 함께 다니는
 * 값이면 타입 하나로 묶어 두는 편이 그 변경을 한 자리로 모은다.
 */
export interface SurveyCardViewer {
  scope: WorkScope;
  currentUserId: string | null;
  isSuperadmin: boolean;
  /** 내가 팀장인 팀 — 팀원과 팀장의 권한이 갈리는 근사에서만 쓴다. */
  leaderTeamIds: readonly string[];
}

/**
 * 설문 카드의 수정·삭제 노출 여부 **근사치**.
 *
 * 정본은 서버의 `resolveSurveyCapabilities`(server/survey-access, 티켓 07)다. 목록은
 * 참여자 행을 함께 내려받지 않으므로 ownerUserId/visibility/teamId + 현재 작업 범위만으로
 * 근사하고, 실제 강제는 서버 관문이 한다 — 여기가 틀려도 데이터는 새지 않고, 오차는
 * "실제보다 자주 비활성으로 보이는" 안전한 방향이다.
 *
 * - 슈퍼어드민: 항상 true.
 * - 본인 소유 설문: 항상 true.
 * - 팀 공개(visibility='team') + 지금 보고 있는 팀 범위와 설문 teamId 일치: true.
 * - 그 외(초대 전용 설문의 비소유자, 시스템 전체 보기의 남의 설문 등): false.
 */
export function canEditSurveyCard(
  survey: SurveyCardCapabilitySubject,
  viewer: SurveyCardViewer,
): boolean {
  const { scope, currentUserId, isSuperadmin } = viewer;
  if (isSuperadmin) return true;
  if (currentUserId !== null && survey.ownerUserId === currentUserId) return true;
  // 참여자는 팀과 무관하게 편집한다(스펙 §4·§8) — 초대받은 타 팀 설문이 여기로 들어온다.
  if (survey.isParticipant) return true;
  if (survey.visibility === 'team' && scope.kind === 'team' && survey.teamId === scope.teamId) {
    return true;
  }
  return false;
}

/**
 * 설문 카드의 「분석」 노출 여부 **근사치**.
 *
 * 분석 화면은 복호화된 원문 응답을 렌더하므로 `analytics.view` 뿐 아니라 `responses.view`
 * 도 요구한다(Codex 적대적 리뷰). 그런데 팀 공개 설문의 **일반 팀원**은 analytics.view 는
 * 있어도 responses.view 가 없다 — 버튼을 그대로 두면 눌렀을 때 404 로 떨어진다.
 *
 * 그래서 이 근사는 `canEditSurveyCard` 보다 좁다. responses.view 를 주는 주체만 통과시킨다:
 * 슈퍼어드민 · 소유자 · 소유 팀 팀장 · **참여자**(티켓 18). 팀원만 제외다.
 *
 * 참여자가 들어오면서 이 근사와 `canManageSurveyAccessCard` 가 **갈렸다**. 티켓 16 당시에는
 * 둘의 결과가 같았고 이유만 달랐는데(참여자는 responses.view 는 갖고 manageAccess 는 못
 * 갖는다), 목록이 참여 행을 싣게 된 지금 그 차이가 실제로 드러난다.
 */
export function canViewSurveyAnalyticsCard(
  survey: SurveyCardCapabilitySubject,
  viewer: SurveyCardViewer,
): boolean {
  return hasFullSurveyControl(survey, viewer) || survey.isParticipant;
}

/**
 * 공유 설정의 **공개 범위 세그먼트**를 만질 수 있는지 **근사치** (티켓 16, .pen FLOW 4-2).
 *
 * 서버 요구는 `survey.manageAccess` 이고 그것을 주는 열은 셋뿐이다 — 슈퍼어드민 · 소유 팀에
 * 남아 있는 소유자 · 소유 팀 팀장. 팀 공개 설문의 팀원은 `survey.edit` 은 있어도 이건 없다
 * (스펙 §7: 범위 변경은 소유자·팀장·슈퍼어드민만).
 *
 * **참여자는 여기 못 들어온다** — 티켓 16 이 예고한 분기점이 티켓 18 에서 실제로 갈렸다.
 * `canViewSurveyAnalyticsCard` 가 요구하는 responses.view 는 참여자도 갖지만 manageAccess 는
 * 소유자·팀장·슈퍼어드민뿐이다(스펙 §8). 두 근사를 이름 하나로 합쳤다면 참여자를 넓히는
 * 한 줄이 공개 범위까지 조용히 열었을 것이다.
 *
 * 모달을 **여는 것**은 이 판정이 막지 않는다. 접근 가능한 내부인이면 누구나 참여자를 추가할
 * 수 있어야 하므로(스펙 §7) 잠기는 것은 범위 세그먼트뿐이다.
 */
export function canManageSurveyAccessCard(
  survey: SurveyCardCapabilitySubject,
  viewer: SurveyCardViewer,
): boolean {
  return hasFullSurveyControl(survey, viewer);
}

/**
 * 서버 매트릭스의 **전권 세 열**(슈퍼어드민 · 소유자 · 소유 팀 팀장)에 해당하는가.
 *
 * 소유자 분기가 팀 소속을 함께 보는 것은 서버 판정과 맞추기 위해서다 — 소유 팀에서 빠진
 * 소유자는 서버에서 전권을 잃는다(survey-access 의 revocation 계약).
 */
function hasFullSurveyControl(
  survey: SurveyCardCapabilitySubject,
  { scope, currentUserId, isSuperadmin, leaderTeamIds }: SurveyCardViewer,
): boolean {
  if (isSuperadmin) return true;
  const inOwningTeam = scope.kind === 'team' && survey.teamId === scope.teamId;
  if (currentUserId !== null && survey.ownerUserId === currentUserId && inOwningTeam) return true;
  if (survey.teamId !== null && leaderTeamIds.includes(survey.teamId)) return true;
  return false;
}
