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
 * 입장 뒤에 끊긴 응답자에게 보일 문구 — 진행 중 마감 문구, 비어 있으면 기존 마감 문구.
 * 둘 다 비면 null 이고, 그때의 기본 문구(사과 톤)는 응답 화면이 상수로 갖는다
 * (`features/survey-response/lib/quota-gate` QUOTA_MID_SURVEY_CLOSED_FALLBACK).
 */
export function resolveMidSurveyClosedMessage(
  config: Pick<QuotaConfig, 'closedMessage' | 'midSurveyClosedMessage'>,
): string | null {
  const mid = config.midSurveyClosedMessage;
  if (typeof mid === 'string' && mid.trim() !== '') return mid;
  return config.closedMessage ?? null;
}
