// 메일 JSONB 계약 — mail_templates.attachments, mail_campaigns.filter_snapshot·status, mail_recipients.send_payload_snapshot·status.
// DB 스키마($type<>)·서버·UI 가 공유하는 어휘 — 런타임 의존 없음(리터럴 상수 제외).

// ─────────────────────────────────────────────────────────────────────────────
// 메일 (mail_templates) 관련 JSONB 타입
// ─────────────────────────────────────────────────────────────────────────────

/** mail_templates.attachments 의 각 원소 */
export interface MailAttachment {
  /** R2 object key — 예: mail/<surveyId>/<uuid>.pdf */
  key: string;
  filename: string;
  size: number; // bytes
  mime: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 메일 단체 메일 (mail_campaigns) 관련 JSONB 타입
// ─────────────────────────────────────────────────────────────────────────────

/**
 * mail_campaigns.filter_snapshot — 마법사 ②단계 필터 조건 보존.
 * 단체 메일 사후 "이 단체 메일 미응답자 재발송" 동선에서 prefill 용으로 활용.
 */
export interface CampaignFilterSnapshot {
  /** 다중 절 필터 (조사대상목록과 동일 직렬화). blindIndex 미포함 raw — 요청 시 재계산. */
  clauses?: { source: string; value: string; op: 'AND' | 'OR' | null }[];
  /** 미응답자만 (responded_at IS NULL) — 별도 체크박스로 유지 */
  unrespondedOnly?: boolean;
  /** "발송 후 N일 경과 단체 메일의 미오픈자 재발송" 동선 (?from=<cid>&unopenedAfterDays=7) */
  unopenedFromCampaignId?: string;
  unopenedAfterDays?: number;
  /** @deprecated legacy 단순 검색 필드 — 신규 생성엔 미사용, 기존 저장 캠페인 읽기 호환용. */
  qfield?: 'all' | 'resid' | 'email' | 'group' | 'biz';
  /** @deprecated legacy 검색어 */
  q?: string;
  /** @deprecated legacy 결과코드 필터 */
  resultCodes?: string[];
  /** @deprecated legacy 그룹값 필터 */
  groupValues?: string[];
}

/** mail_recipients.send_payload_snapshot — 최초 claim 시 확정한 재시도 불변 payload. */
export interface MailRecipientSendPayloadSnapshot {
  from: string;
  replyTo: string;
  to: string;
  subject: string;
  html: string;
  attachments: Array<{
    filename: string;
    contentType?: string;
    sha256: string;
  }>;
}

// mail_campaigns.status — 발송 회차 상태
export const mailCampaignStatusValues = [
  'draft',
  'queued',
  'sending',
  'completed',
  'partial',
  'cancelled',
] as const;
export type MailCampaignStatus = (typeof mailCampaignStatusValues)[number];

// mail_recipients.status 전이: queued → sending → sent → delivered → opened
//   또는 → bounced/complained/failed (terminal), 또는 → skipped_unsubscribed (insert 시점)
export const mailRecipientStatusValues = [
  'queued',
  'sending',
  'sent',
  'delivered',
  'opened',
  'bounced',
  'complained',
  'failed',
  'skipped_unsubscribed',
] as const;
export type MailRecipientStatus = (typeof mailRecipientStatusValues)[number];
