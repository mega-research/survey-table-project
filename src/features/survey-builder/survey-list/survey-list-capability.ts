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
  /**
   * 그 참여가 full 등급인가 (0123). 제한 참여자는 편집은 되지만 `responses.view` 가 없어
   * 분석 화면이 404 다 — 분석 근사는 이 값을 본다.
   */
  isFullParticipant: boolean;
  /**
   * 내 팀원이 이 설문에 초대돼 있는가 — 초대의 **팀장 전파**.
   *
   * 전파는 내 이름으로 된 참여 행을 만들지 않아 `isParticipant` 로는 보이지 않는다. 목록이
   * 따로 실어 보내지 않으면 서버가 편집을 허락한 전파 팀장에게 「수정」이 잠긴다.
   */
  isLedParticipant: boolean;
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
 * - 참여자 · 초대를 전파받은 팀장: true (둘 다 `survey.edit` 을 갖는다).
 * - 팀 공개(visibility='team') + 지금 보고 있는 팀 범위와 설문 teamId 일치: true.
 * - 그 외(초대 전용 설문의 비소유자, 시스템 전체 보기의 남의 설문 등): false.
 *
 * **삭제·그룹 이동은 이 판정으로 갈리지 않는다.** 서버 열에서 셋이 서로 다르기 때문이다 —
 * 참여자는 편집은 되고 그룹 정리는 안 되며(surveyGroup.manage 없음), 팀원·제한 참여자·전파
 * 팀장은 편집은 되고 삭제는 안 된다(survey.delete 없음). 하나로 묶으면 눌렀을 때 거부되는
 * 버튼이 열린 채로 보인다.
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
  // 초대를 전파받은 팀장도 같은 열(LIMITED_PARTICIPANT_CAPS)에 survey.edit 을 갖는다.
  if (survey.isLedParticipant) return true;
  if (survey.visibility === 'team' && scope.kind === 'team' && survey.teamId === scope.teamId) {
    return true;
  }
  return false;
}

/**
 * 카드 케밥의 **삭제** 노출 여부 **근사치**.
 *
 * `survey.delete` 를 주는 열은 전권 셋과 **full 참여자**뿐이다. 팀 공개 설문의 팀원·제한
 * 참여자·전파 팀장은 편집은 하되 삭제는 못 한다(TEAM_MEMBER_CAPS·LIMITED_PARTICIPANT_CAPS
 * 에 survey.delete 가 없다). 편집 근사를 그대로 쓰면 그 사람들에게 「삭제」가 열린 채로
 * 보이고, 누르면 서버가 거부해 에러 토스트가 뜬다.
 *
 * 판정 결과가 `canViewSurveyAnalyticsCard` 와 같지만 **이유가 다르다**(저쪽은 responses.view).
 * 이름을 하나로 합치면 한쪽 열이 바뀌는 날 다른 쪽이 조용히 따라 움직인다 — 분석 근사와
 * 공개 범위 근사를 갈라 둔 것과 같은 이유다.
 */
export function canDeleteSurveyCard(
  survey: SurveyCardCapabilitySubject,
  viewer: SurveyCardViewer,
): boolean {
  return hasFullSurveyControl(survey, viewer) || survey.isFullParticipant;
}

/**
 * 카드 케밥의 **그룹 이동** 노출 여부 **근사치**.
 *
 * 요구는 `surveyGroup.manage` + `survey.edit` 짝이다(procedures/survey-groups). 그룹은 팀
 * 소유 구조라 참여자·전파 팀장에게는 manage 가 없다 — 편집 근사를 쓰면 타 팀 설문을 내 팀
 * 폴더로 옮기려다 CONFLICT 를 받는다. 통과하는 것은 전권 셋과 **그 팀 팀원**이다.
 */
export function canManageSurveyGroupCard(
  survey: SurveyCardCapabilitySubject,
  viewer: SurveyCardViewer,
): boolean {
  if (hasFullSurveyControl(survey, viewer)) return true;
  const { scope } = viewer;
  return survey.visibility === 'team' && scope.kind === 'team' && survey.teamId === scope.teamId;
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
  return hasFullSurveyControl(survey, viewer) || survey.isFullParticipant;
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
