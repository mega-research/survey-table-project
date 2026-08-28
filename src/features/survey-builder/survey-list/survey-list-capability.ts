// 설문 카드 버튼 노출 근사 — 순수 판정 (역할 모델 v2 티켓 08).

import type { SurveyVisibility, WorkScope } from '@/shared/contracts/workspace';

/** canEditSurveyCard 판정에 필요한 목록 아이템 최소 필드. */
export interface SurveyCardCapabilitySubject {
  ownerUserId: string | null;
  visibility: SurveyVisibility;
  teamId: string | null;
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
  scope: WorkScope,
  currentUserId: string | null,
  isSuperadmin: boolean,
): boolean {
  if (isSuperadmin) return true;
  if (currentUserId !== null && survey.ownerUserId === currentUserId) return true;
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
 * 슈퍼어드민 · 소유자 · 소유 팀 팀장. 팀원은 제외다. 참여자(티켓 18)는 responses.view 를
 * 갖지만 목록이 참여 행을 안 내려받으므로 그때 근사를 넓혀야 한다 — 지금은 안전한 방향
 * (실제보다 자주 감춤)으로 틀린다.
 *
 * 판정 자체는 전권 세 열(hasFullSurveyControl)과 같다.
 */
export function canViewSurveyAnalyticsCard(
  survey: SurveyCardCapabilitySubject,
  scope: WorkScope,
  currentUserId: string | null,
  isSuperadmin: boolean,
  leaderTeamIds: readonly string[],
): boolean {
  return hasFullSurveyControl(survey, scope, currentUserId, isSuperadmin, leaderTeamIds);
}

/**
 * 공유 설정의 **공개 범위 세그먼트**를 만질 수 있는지 **근사치** (티켓 16, .pen FLOW 4-2).
 *
 * 서버 요구는 `survey.manageAccess` 이고 그것을 주는 열은 셋뿐이다 — 슈퍼어드민 · 소유 팀에
 * 남아 있는 소유자 · 소유 팀 팀장. 팀 공개 설문의 팀원은 `survey.edit` 은 있어도 이건 없다
 * (스펙 §7: 범위 변경은 소유자·팀장·슈퍼어드민만).
 *
 * 오늘은 `canViewSurveyAnalyticsCard` 와 판정이 같지만 **이유가 다르다**. 저쪽이 요구하는
 * responses.view 는 참여자(티켓 18)도 갖고 이쪽 manageAccess 는 참여자도 못 갖는다 — 참여
 * 행이 목록에 실리는 날 둘은 갈린다. 그래서 이름과 문서를 따로 둔다.
 *
 * 모달을 **여는 것**은 이 판정이 막지 않는다. 접근 가능한 내부인이면 누구나 참여자를 추가할
 * 수 있어야 하므로(스펙 §7) 잠기는 것은 범위 세그먼트뿐이다.
 */
export function canManageSurveyAccessCard(
  survey: SurveyCardCapabilitySubject,
  scope: WorkScope,
  currentUserId: string | null,
  isSuperadmin: boolean,
  leaderTeamIds: readonly string[],
): boolean {
  return hasFullSurveyControl(survey, scope, currentUserId, isSuperadmin, leaderTeamIds);
}

/**
 * 서버 매트릭스의 **전권 세 열**(슈퍼어드민 · 소유자 · 소유 팀 팀장)에 해당하는가.
 *
 * 소유자 분기가 팀 소속을 함께 보는 것은 서버 판정과 맞추기 위해서다 — 소유 팀에서 빠진
 * 소유자는 서버에서 전권을 잃는다(survey-access 의 revocation 계약).
 */
function hasFullSurveyControl(
  survey: SurveyCardCapabilitySubject,
  scope: WorkScope,
  currentUserId: string | null,
  isSuperadmin: boolean,
  leaderTeamIds: readonly string[],
): boolean {
  if (isSuperadmin) return true;
  const inOwningTeam = scope.kind === 'team' && survey.teamId === scope.teamId;
  if (currentUserId !== null && survey.ownerUserId === currentUserId && inOwningTeam) return true;
  if (survey.teamId !== null && leaderTeamIds.includes(survey.teamId)) return true;
  return false;
}
