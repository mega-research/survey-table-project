import { Inngest } from 'inngest';

/**
 * Inngest 클라이언트.
 *
 * v4 SDK 부터 schemas 옵션이 별도 헬퍼(eventType/staticSchema)로 이동.
 * 본 프로젝트는 이벤트 가짓수가 적어 runtime payload 검증을
 * 핸들러 안에서 직접 처리 (campaign-dispatcher 의 event.data 캐스팅).
 *
 * 이벤트 카탈로그 (수동 관리):
 *   - mail/campaign.queued — { campaignId: string; surveyId: string }
 */
export const inngest = new Inngest({
  id: 'survey-table-project',
});

/** mail/campaign.queued 이벤트 payload (수동 타입 — schemas 미사용 보완) */
export interface MailCampaignQueuedData {
  campaignId: string;
  surveyId: string;
}
