// 메일 경계 계약 — 미리보기 샘플과 메일 콘솔 read model 행.
// 같은 폴더의 mail.ts — DB 에 저장되는 JSONB 문서 어휘. 이 파일 — 서버와 UI 사이 경계를 건너는 모양.
// client-safe — zod 밖 런타임 의존 없음(server-only·Node·DB 없음).
import * as z from 'zod';

import type {
  MailCampaignKind,
  MailCampaignStatus,
  MailRecipientStatus,
} from '@/shared/contracts/mail';

// ─────────────────────────────────────────────────────────────────────────────
// 템플릿 미리보기 — 해당 설문의 컨택 1건 샘플
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 메일 템플릿 미리보기용 — 해당 설문의 첫 컨택 1건 샘플.
 * inviteUrl 은 서버에서 NEXT_PUBLIC_APP_URL 기준으로 빌드된 값.
 */
export const MailPreviewSampleSchema = z.object({
  attrs: z.record(z.string(), z.string()),
  inviteUrl: z.string(),
  email: z.string().nullable(),
  resid: z.number(),
});
export type MailPreviewSample = z.infer<typeof MailPreviewSampleSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 단체 메일 콘솔 read model 행 — RSC 가 SQL 로 뽑아 클라이언트 표에 props 로 넘기는 모양.
// 조회 자체는 server/mail/services 소관이고 여기는 모양만 둔다.
// ─────────────────────────────────────────────────────────────────────────────

export interface CampaignRow {
  id: string;
  runNumber: number;
  isTest: boolean;
  title: string;
  status: MailCampaignStatus;
  mailTemplateId: string | null;
  templateName: string | null;
  recipientCount: number;
  queuedCount: number;
  sentCount: number;
  deliveredCount: number;
  openedCount: number;
  bouncedCount: number;
  complainedCount: number;
  failedCount: number;
  skippedUnsubscribedCount: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  createdBy: string | null;
}

// 단체 메일 detail 의 recipients 목록 (status 필터 + email 검색 + 페이지네이션)
export interface CampaignRecipientRow {
  id: string;
  contactTargetId: string | null;
  contactResid: number | null;
  contactGroupValue: string | null;
  emailMasked: string;
  status: MailRecipientStatus;
  /** contact_targets.unsubscribed_at — 발송 status 와 별도. 수신거부 후 badge 표시용. */
  unsubscribedAt: Date | null;
  resendMessageId: string | null;
  errorReason: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  openedAt: Date | null;
  bouncedAt: Date | null;
  complainedAt: Date | null;
  /** 컨택 최신 회차의 result_code — 조사 대상 목록의 컨택결과 컬럼과 같은 값. */
  latestResultCode: string | null;
}

export interface CampaignCandidateRow {
  id: string;
  resid: number;
  email: string;
  emailMasked: string;
  groupValue: string | null;
  attrs: Record<string, string>;
  respondedAt: Date | null;
  /**
   * 매칭 응답의 status — 표시와 필터가 같은 축을 보게 하는 값.
   * respondedAt 은 완료 시각만 담아 진행중·이탈을 미응답과 구분하지 못한다.
   */
  responseStatus: string | null;
  /** 미완료 응답의 진척률 — 상태 pill 의 부속 표시 (조사 대상 목록과 같은 규칙). */
  progressPct: number | null;
  latestResultCode: string | null;
  /** 가장 최근 단체 메일에서의 수신 status. 발송 이력 없으면 null — 재전송 명단 대조용. */
  latestMailStatus: MailRecipientStatus | null;
}

/** 미리보기 정렬 — 번호 / 응답여부 / 수신 상황 / 최근 결과코드. 이메일·그룹은 PII·비용 사유로 제외. */
export type CampaignSortKey = 'resid' | 'responded' | 'mailStatus' | 'resultCode';

export type CampaignSortDir = 'asc' | 'desc';

export interface CampaignExclusionCounts {
  /** unsubscribed_at IS NOT NULL */
  unsubscribed: number;
  /** 부정 결과코드 마킹 (수신거부 아님) */
  negativeCode: number;
  /** email PII 부재 (위 둘 아님) */
  emailMissing: number;
  /** 반송 이력 — 현재 이메일이 반송 당시 주소와 동일 (위 셋 아님) */
  bounced: number;
}

export interface UnsubscribedContactRow {
  id: string;
  resid: number;
  emailMasked: string;
  groupValue: string | null;
  unsubscribedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// 메일 비용 정산 화면 행 (/admin/billing/mail-cost)
// ─────────────────────────────────────────────────────────────────────────────

export interface CampaignCycleRow {
  campaignId: string;
  surveyId: string;
  surveyTitle: string;
  runNumber: number;
  kind: MailCampaignKind;
  title: string;
  status: MailCampaignStatus;
  startedAt: Date;
  completedAt: Date | null;
  billableCount: number;
  includedCount: number;
  overageCount: number;
  costKrw: number;
  averageUnitPriceKrw: number;
  isTest: boolean;
  archivedAt: Date | null;
}

export interface CycleSummary {
  cycleKey: string;
  startedAt: Date;
  endsAt: Date;
  startLabel: string;
  endLabel: string;
  planLabel: string;
  billingDayOfMonth: number;
  includedEmails: number;
  overagePer1kKrw: number;
  isCurrent: boolean;
  totalBillable: number;
  totalIncluded: number;
  totalOverage: number;
  overageCostKrw: number;
  monthlyFeeKrw: number;
  totalCostKrw: number;
  campaigns: CampaignCycleRow[];
}

export interface BillingPeriodRow {
  id: string;
  startDate: string;
  billingDayOfMonth: number;
  planLabel: string;
  monthlyFeeKrw: number;
  includedEmails: number;
  overagePer1kKrw: number;
  note: string | null;
  createdAt: Date;
}
