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
