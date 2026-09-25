import type { QuotaConfig } from '@/shared/contracts/quota';

/**
 * 「진행 중 마감」이 실제로 작동하는 플랜인가 — 집행 중이고 옵션이 켜져 있다.
 * 제출 시점 하드 차단과 게이트 표식이 같은 판정을 쓴다.
 */
export function isMidSurveyCloseActive<T extends Pick<QuotaConfig, 'enabled' | 'midSurveyClose'>>(
  config: T | null | undefined,
): config is T {
  return Boolean(config?.enabled && config.midSurveyClose);
}

/**
 * 진행 중 마감(입장 뒤에 끊긴 응답자) 기본 문구 — 사과 톤. 플랜의 두 문구가 다 비었을 때
 * 응답 화면과 편집 화면 미리보기가 같은 값을 보인다. 입장 판정에서 막힌 응답자의 기본 문구는
 * 종전대로 already-responded-view 의 quota_closed body 다.
 */
export const QUOTA_MID_SURVEY_CLOSED_FALLBACK =
  '죄송합니다. 응답 중에 해당 조건의 모집이 완료되어 더 이상 진행하실 수 없습니다. 소중한 시간을 내어 참여해 주셔서 감사합니다.';

/** 입장 뒤에 막힌 응답자에게 보일 본문 — 서버 문구(폴백 적용 완료), 없으면 사과 톤 기본 문구. */
export function midSurveyClosedBody(serverMessage: string | null | undefined): string {
  return serverMessage && serverMessage.trim() ? serverMessage : QUOTA_MID_SURVEY_CLOSED_FALLBACK;
}

/**
 * 입장 뒤에 끊긴 응답자에게 보일 문구 — 진행 중 마감 문구, 비어 있으면 기존 마감 문구.
 * 둘 다 비면 null 이고, 그때의 기본 문구는 위 QUOTA_MID_SURVEY_CLOSED_FALLBACK 이다.
 */
export function resolveMidSurveyClosedMessage(
  config: Pick<QuotaConfig, 'closedMessage' | 'midSurveyClosedMessage'>,
): string | null {
  const mid = config.midSurveyClosedMessage;
  if (typeof mid === 'string' && mid.trim() !== '') return mid;
  return config.closedMessage ?? null;
}
