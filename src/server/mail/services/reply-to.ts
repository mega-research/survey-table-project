import 'server-only';

import { getSurveyOwnerEmail } from '@/server/read-models/survey-owner-email';

interface ResolveSendReplyToInput {
  surveyId: string;
  /** 템플릿·캠페인 스냅샷의 명시 회신 주소. 비어 있으면 소유자 연동. */
  replyTo: string | null;
  fromLocal: string;
  fromDomain: string | undefined;
}

/**
 * 발송 시점의 회신 주소를 해석한다 (티켓 20, 스펙 §12).
 *
 * 우선순위는 **명시 → 소유자 → 발신 주소** 다.
 *
 * 1. 스냅샷에 주소가 박혀 있으면 그것이 답이다. 발송자가 「이 캠페인의 답장은 여기로」를
 *    명시한 것이라 소유권이 바뀌어도 움직이지 않는다. 그리고 이 분기에서는 **소유자를
 *    조회하지 않는다** — `??` 의 단락 평가가 계약이다. 고정 회신 캠페인이 수천 통이라도
 *    소유자 조회 왕복은 0 이고, 소유자 조회가 실패해도 그 캠페인은 영향을 받지 않는다.
 * 2. 비어 있으면 **지금 이 순간의 소유자** 이메일이다. 이전 뒤 발송분부터 새 소유자에게
 *    회신이 가는 것이 이 티켓의 전부다 — 그래서 캠페인 생성 시점이 아니라 발송 시점에 읽는다.
 *    승계 대기(소유자가 떠났는데 후임 미지정) 설문은 떠난 소유자 주소가 그대로 나온다
 *    (getSurveyOwnerEmail 주석 참조).
 * 3. 소유자조차 없으면 발신 주소로 접는다 — 회신 헤더 없는 메일을 보내는 것보다 낫다.
 *
 * 캠페인 발송과 템플릿 테스트 발송이 **같은 함수**를 쓴다. 나누면 「테스트 메일에 답장했더니
 * 아무도 못 받는」 어긋남이 생긴다.
 */
export async function resolveSendReplyTo(input: ResolveSendReplyToInput): Promise<string | null> {
  const explicit = input.replyTo?.trim();
  if (explicit) return explicit;

  const ownerEmail = await getSurveyOwnerEmail(input.surveyId);
  if (ownerEmail) return ownerEmail;

  return input.fromDomain ? `${input.fromLocal}@${input.fromDomain}` : null;
}
