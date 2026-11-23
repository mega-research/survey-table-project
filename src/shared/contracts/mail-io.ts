// 메일 경계 계약 — 미리보기 샘플과 메일 콘솔 read model 행.
// 같은 폴더의 mail.ts — DB 에 저장되는 JSONB 문서 어휘. 이 파일 — 서버와 UI 사이 경계를 건너는 모양.
// client-safe — zod 밖 런타임 의존 없음(server-only·Node·DB 없음).
import * as z from 'zod';

import type {
  MailCampaignKind,
  MailCampaignStatus,
  MailLinkKind,
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
  /** 샘플이 테스트 조사 대상자다 — 초대 링크가 눌러서 열리는 테스트 링크다(테스트 모드가 켜진 설문) */
  isTest: z.boolean().optional(),
});
export type MailPreviewSample = z.infer<typeof MailPreviewSampleSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 단체 메일 콘솔 read model 행 — RSC 가 SQL 로 뽑아 클라이언트 표에 props 로 넘기는 모양.
// 조회 자체는 server/mail/services 소관이고 여기는 모양만 둔다.
// ─────────────────────────────────────────────────────────────────────────────

export interface CampaignRow {
  id: string;
  runNumber: number;
  /** 'fallback' 이면 대체 발송 회차 — 회차 번호 대신 「대체」로 보인다 */
  kind: MailCampaignKind;
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
  /**
   * 이 회차에서 메일의 설문 링크를 누른 수신자 수(사람 수, 보관된 수신자 제외) — CONTEXT.md 「링크 클릭」.
   * 집계 열이 아니라 조회할 때 센다. 눌렀다는 것이지 응답했다는 것이 아니다.
   */
  clickedCount: number;
  bouncedCount: number;
  complainedCount: number;
  failedCount: number;
  skippedUnsubscribedCount: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  createdBy: string | null;
}

/**
 * 조사 대상 한 명의 링크 클릭 상태 — 저장하는 값이 아니라 읽을 때 계산하는 값이다(CONTEXT.md 「링크 클릭」).
 * 'clicked' 는 어느 발송 회차에서든 설문 링크를 한 번이라도 눌렀다, 'not_clicked' 는 발송 이력은 있는데 누르지
 * 않았다. 발송 이력이 없으면 null 이다. 조사 대상 목록·엑셀·단체 메일 위저드의 행이 싣는다.
 */
export type LinkClickState = 'clicked' | 'not_clicked';

/**
 * 수신자가 누른 링크 한 줄 — 링크 종류마다(그 밖의 링크는 주소마다) 하나이고 시각은 처음 누른 때다
 * (CONTEXT.md 「링크 클릭」). 설문·수신거부 링크는 주소를 싣지 않는다.
 */
export interface RecipientLinkClick {
  kind: MailLinkKind;
  url: string | null;
  firstClickedAt: Date;
}

// 단체 메일 detail 의 recipients 목록 (status 필터 + email 검색 + 페이지네이션)
export interface CampaignRecipientRow {
  id: string;
  contactTargetId: string | null;
  contactResid: number | null;
  contactGroupValue: string | null;
  /** 조사 대상 attrs 전체 — 컬럼 스킴의 showInMail 열을 표에 띄우기 위해 실어 보낸다 */
  contactAttrs: Record<string, string>;
  /** 메일 표시를 켠 개인정보 열의 마스킹 힌트 (column_key → 힌트). 켠 열이 없으면 빈 객체 */
  contactPiiMasks: Record<string, string>;
  /** 대상이 지금 맡겨진 컨택원 이름 — 메일 표시를 켠 비게스트 화면에서만 싣는다. 배정 없음이면 null */
  contactAssignmentName: string | null;
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
  /** 이 회차의 메일에서 누른 링크 — 설문 링크 · 수신거부 · 그 밖의 링크 순. 누른 것이 없으면 빈 배열. */
  linkClicks: RecipientLinkClick[];
}

export interface CampaignCandidateRow {
  id: string;
  resid: number;
  email: string;
  emailMasked: string;
  groupValue: string | null;
  attrs: Record<string, string>;
  /** 메일 표시를 켠 개인정보 열의 마스킹 힌트 (column_key → 힌트). 켠 열이 없으면 빈 객체 */
  piiMasks: Record<string, string>;
  /** 대상이 지금 맡겨진 컨택원 이름 — 메일 표시를 켠 비게스트 화면에서만 싣는다. 배정 없음이면 null */
  assignmentName: string | null;
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
  /**
   * 링크 클릭 상태 — 조사 대상 목록의 「링크 클릭」 열과 같은 값·같은 식(CONTEXT.md 「링크 클릭」).
   * 발송 이력이 없으면 null. 독촉 대상 고르기에 쓴다.
   */
  linkClick: LinkClickState | null;
}

/** 미리보기 정렬 — 번호 / 응답여부 / 수신 상황 / 최근 결과코드. 이메일·그룹은 PII·비용 사유로 제외. */
export type CampaignSortKey = 'resid' | 'responded' | 'mailStatus' | 'resultCode';

/**
 * 미리보기 표의 실제 정렬 — 위 넷에 더해 컬럼 설정의 기본 정렬 열(`attrs.<key>`) 하나.
 * 주소에 정렬이 없으면 그 열 오름차순으로 열린다(`lib/contacts/default-sort`).
 */
export type CampaignListSortKey = CampaignSortKey | `attrs.${string}`;

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

/**
 * 단체 메일 위저드 미리보기 「그룹」 열 머리 필터의 선택지 — 발송 후보에 실제로 있는 그룹 값.
 * 지금 걸린 조건과 무관하게 후보 전체에서 뽑는다(한 값을 골라도 나머지 선택지가 남는다).
 */
export interface CampaignGroupFacet {
  /** 그룹 값(빈 값 제외, 숫자 인식 오름차순). 상한을 넘으면 앞에서부터 잘린다. */
  values: string[];
  /** 그룹이 빈 후보가 있는가 — 「— (없음)」 선택지를 낼지 */
  hasEmpty: boolean;
}

export interface UnsubscribedContactRow {
  id: string;
  resid: number;
  emailMasked: string;
  groupValue: string | null;
  attrs: Record<string, string>;
  /** 메일 표시를 켠 개인정보 열의 마스킹 힌트 (column_key → 힌트). 켠 열이 없으면 빈 객체 */
  piiMasks: Record<string, string>;
  /** 대상이 지금 맡겨진 컨택원 이름 — 메일 표시를 켠 비게스트 화면에서만 싣는다. 배정 없음이면 null */
  assignmentName: string | null;
  /** 링크 수신거부 시각. 결과코드 축으로만 수신거부면 null */
  unsubscribedAt: Date | null;
  /** 최근 결과코드가 수신거부인 회차의 시각. 그 축이 아니면 null */
  resultUnsubscribedAt: Date | null;
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
