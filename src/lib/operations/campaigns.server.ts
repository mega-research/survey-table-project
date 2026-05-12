import 'server-only';

import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';

import { db } from '@/db';
import {
  contactAttempts,
  contactTargets,
  mailCampaigns,
  mailRecipients,
  mailTemplates,
} from '@/db/schema';
import type {
  CampaignFilterSnapshot,
  MailAttachment,
} from '@/db/schema/schema-types';
import type { MailCampaignStatus, MailRecipientStatus } from '@/db/schema/mail';
import { maskEmail } from '@/lib/operations/contacts';

const DEFAULT_PAGE_SIZE = 20;

// ─────────────────────────────────────────────────────────────────────────────
// 캠페인 list (메인 페이지)
// ─────────────────────────────────────────────────────────────────────────────

export interface CampaignRow {
  id: string;
  runNumber: number;
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

export interface ListCampaignsResult {
  rows: CampaignRow[];
  total: number;
  page: number;
}

export async function listCampaignsForSurvey(args: {
  surveyId: string;
  page?: number;
  pageSize?: number;
}): Promise<ListCampaignsResult> {
  const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;
  const where = eq(mailCampaigns.surveyId, args.surveyId);

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(mailCampaigns)
    .where(where);
  const total = countRow?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, args.page ?? 1), totalPages);
  const offset = (clampedPage - 1) * pageSize;

  const rows = await db
    .select({
      id: mailCampaigns.id,
      runNumber: mailCampaigns.runNumber,
      title: mailCampaigns.title,
      status: mailCampaigns.status,
      mailTemplateId: mailCampaigns.mailTemplateId,
      templateName: mailTemplates.name,
      recipientCount: mailCampaigns.recipientCount,
      queuedCount: mailCampaigns.queuedCount,
      sentCount: mailCampaigns.sentCount,
      deliveredCount: mailCampaigns.deliveredCount,
      openedCount: mailCampaigns.openedCount,
      bouncedCount: mailCampaigns.bouncedCount,
      complainedCount: mailCampaigns.complainedCount,
      failedCount: mailCampaigns.failedCount,
      skippedUnsubscribedCount: mailCampaigns.skippedUnsubscribedCount,
      startedAt: mailCampaigns.startedAt,
      completedAt: mailCampaigns.completedAt,
      createdAt: mailCampaigns.createdAt,
      createdBy: mailCampaigns.createdBy,
    })
    .from(mailCampaigns)
    .leftJoin(mailTemplates, eq(mailCampaigns.mailTemplateId, mailTemplates.id))
    .where(where)
    .orderBy(desc(mailCampaigns.createdAt))
    .limit(pageSize)
    .offset(offset);

  return {
    rows: rows.map((r) => ({ ...r, status: r.status as MailCampaignStatus })),
    total,
    page: clampedPage,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 캠페인 detail
// ─────────────────────────────────────────────────────────────────────────────

export interface CampaignDetail {
  id: string;
  surveyId: string;
  runNumber: number;
  title: string;
  status: MailCampaignStatus;
  mailTemplateId: string | null;
  templateName: string | null;
  subjectSnapshot: string;
  bodyHtmlSnapshot: string;
  fromLocalSnapshot: string;
  fromNameSnapshot: string;
  replyToSnapshot: string | null;
  attachmentsSnapshot: MailAttachment[];
  filterSnapshot: CampaignFilterSnapshot;
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

export async function getCampaignDetail(cid: string): Promise<CampaignDetail | null> {
  const [row] = await db
    .select({
      campaign: mailCampaigns,
      templateName: mailTemplates.name,
    })
    .from(mailCampaigns)
    .leftJoin(mailTemplates, eq(mailCampaigns.mailTemplateId, mailTemplates.id))
    .where(eq(mailCampaigns.id, cid))
    .limit(1);
  if (!row) return null;
  const c = row.campaign;
  return {
    id: c.id,
    surveyId: c.surveyId,
    runNumber: c.runNumber,
    title: c.title,
    status: c.status as MailCampaignStatus,
    mailTemplateId: c.mailTemplateId,
    templateName: row.templateName,
    subjectSnapshot: c.subjectSnapshot,
    bodyHtmlSnapshot: c.bodyHtmlSnapshot,
    fromLocalSnapshot: c.fromLocalSnapshot,
    fromNameSnapshot: c.fromNameSnapshot,
    replyToSnapshot: c.replyToSnapshot,
    attachmentsSnapshot: c.attachmentsSnapshot,
    filterSnapshot: c.filterSnapshot,
    recipientCount: c.recipientCount,
    queuedCount: c.queuedCount,
    sentCount: c.sentCount,
    deliveredCount: c.deliveredCount,
    openedCount: c.openedCount,
    bouncedCount: c.bouncedCount,
    complainedCount: c.complainedCount,
    failedCount: c.failedCount,
    skippedUnsubscribedCount: c.skippedUnsubscribedCount,
    startedAt: c.startedAt,
    completedAt: c.completedAt,
    createdAt: c.createdAt,
    createdBy: c.createdBy,
  };
}

// 캠페인 detail 의 recipients 목록 (status 필터 + email 검색 + 페이지네이션)
export interface CampaignRecipientRow {
  id: string;
  contactTargetId: string;
  contactResid: number;
  contactGroupValue: string | null;
  emailMasked: string;
  status: MailRecipientStatus;
  resendMessageId: string | null;
  errorReason: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  openedAt: Date | null;
  bouncedAt: Date | null;
  complainedAt: Date | null;
}

export interface ListCampaignRecipientsResult {
  rows: CampaignRecipientRow[];
  total: number;
  page: number;
}

export async function listCampaignRecipients(args: {
  campaignId: string;
  page?: number;
  pageSize?: number;
  status?: MailRecipientStatus | 'all';
  q?: string;
}): Promise<ListCampaignRecipientsResult> {
  const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;
  const whereParts: SQL[] = [eq(mailRecipients.campaignId, args.campaignId)];

  if (args.status && args.status !== 'all') {
    whereParts.push(eq(mailRecipients.status, args.status));
  }
  const q = (args.q ?? '').trim();
  if (q) {
    const escaped = q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    whereParts.push(sql`${mailRecipients.emailSnapshot} ILIKE ${'%' + escaped + '%'}`);
  }
  const where = and(...whereParts)!;

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(mailRecipients)
    .where(where);
  const total = countRow?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, args.page ?? 1), totalPages);
  const offset = (clampedPage - 1) * pageSize;

  const rows = await db
    .select({
      id: mailRecipients.id,
      contactTargetId: mailRecipients.contactTargetId,
      contactResid: contactTargets.resid,
      contactGroupValue: contactTargets.groupValue,
      email: mailRecipients.emailSnapshot,
      status: mailRecipients.status,
      resendMessageId: mailRecipients.resendMessageId,
      errorReason: mailRecipients.errorReason,
      sentAt: mailRecipients.sentAt,
      deliveredAt: mailRecipients.deliveredAt,
      openedAt: mailRecipients.openedAt,
      bouncedAt: mailRecipients.bouncedAt,
      complainedAt: mailRecipients.complainedAt,
    })
    .from(mailRecipients)
    .innerJoin(contactTargets, eq(mailRecipients.contactTargetId, contactTargets.id))
    .where(where)
    .orderBy(desc(mailRecipients.createdAt))
    .limit(pageSize)
    .offset(offset);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      contactTargetId: r.contactTargetId,
      contactResid: r.contactResid,
      contactGroupValue: r.contactGroupValue,
      emailMasked: maskEmail(r.email),
      status: r.status as MailRecipientStatus,
      resendMessageId: r.resendMessageId,
      errorReason: r.errorReason,
      sentAt: r.sentAt,
      deliveredAt: r.deliveredAt,
      openedAt: r.openedAt,
      bouncedAt: r.bouncedAt,
      complainedAt: r.complainedAt,
    })),
    total,
    page: clampedPage,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 마법사 ②/③ 단계 — 수신자 후보 미리보기
// 컨택 페이지의 listContactsForSurvey 와 비슷하지만 캠페인 발송 가능 조건 강제:
//   - unsubscribed_at IS NULL
//   - email IS NOT NULL AND email != ''
// + 옵션 필터 (미응답자 / 결과코드 / 그룹값 / 검색)
// ─────────────────────────────────────────────────────────────────────────────

export interface CampaignCandidateRow {
  id: string;
  resid: number;
  email: string;
  emailMasked: string;
  groupValue: string | null;
  attrs: Record<string, string>;
  respondedAt: Date | null;
  latestResultCode: string | null;
}

export interface CampaignCandidatesResult {
  rows: CampaignCandidateRow[];
  total: number;
  page: number;
}

function buildCandidateWhere(surveyId: string, filter: CampaignFilterSnapshot): SQL {
  const parts: SQL[] = [
    eq(contactTargets.surveyId, surveyId),
    isNull(contactTargets.unsubscribedAt),
    isNotNull(contactTargets.email),
    ne(contactTargets.email, ''),
  ];

  if (filter.unrespondedOnly) {
    parts.push(isNull(contactTargets.respondedAt));
  }

  const q = (filter.q ?? '').trim();
  if (q) {
    const escaped = q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const pattern = `%${escaped}%`;
    const field = filter.qfield ?? 'all';
    if (field === 'resid') {
      const n = parseInt(q, 10);
      parts.push(Number.isFinite(n) && n > 0 ? eq(contactTargets.resid, n) : sql`false`);
    } else if (field === 'email') {
      parts.push(sql`${contactTargets.email} ILIKE ${pattern}`);
    } else if (field === 'biz') {
      parts.push(sql`${contactTargets.bizNumber} ILIKE ${pattern}`);
    } else if (field === 'group') {
      parts.push(sql`${contactTargets.groupValue} ILIKE ${pattern}`);
    } else {
      const orClause = or(
        sql`${contactTargets.email} ILIKE ${pattern}`,
        sql`${contactTargets.bizNumber} ILIKE ${pattern}`,
        sql`${contactTargets.groupValue} ILIKE ${pattern}`,
      );
      if (orClause) parts.push(orClause);
    }
  }

  if (filter.groupValues && filter.groupValues.length > 0) {
    parts.push(inArray(contactTargets.groupValue, filter.groupValues));
  }

  if (filter.resultCodes && filter.resultCodes.length > 0) {
    const latestResultCodeExpr = sql<string | null>`(
      SELECT result_code FROM contact_attempts
      WHERE contact_target_id = "contact_targets"."id"
      ORDER BY attempt_no DESC LIMIT 1
    )`;
    parts.push(sql`${latestResultCodeExpr} = ANY(${filter.resultCodes})`);
  }

  return and(...parts)!;
}

export async function previewCampaignCandidates(args: {
  surveyId: string;
  filter: CampaignFilterSnapshot;
  page?: number;
  pageSize?: number;
}): Promise<CampaignCandidatesResult> {
  const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;
  const where = buildCandidateWhere(args.surveyId, args.filter);

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(contactTargets)
    .where(where);
  const total = countRow?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, args.page ?? 1), totalPages);
  const offset = (clampedPage - 1) * pageSize;

  const latestResultCodeExpr = sql<string | null>`(
    SELECT result_code FROM contact_attempts
    WHERE contact_target_id = "contact_targets"."id"
    ORDER BY attempt_no DESC LIMIT 1
  )`;

  const rows = await db
    .select({
      id: contactTargets.id,
      resid: contactTargets.resid,
      email: contactTargets.email,
      groupValue: contactTargets.groupValue,
      attrs: contactTargets.attrs,
      respondedAt: contactTargets.respondedAt,
      latestResultCode: latestResultCodeExpr.as('latest_result_code'),
    })
    .from(contactTargets)
    .where(where)
    .orderBy(contactTargets.resid)
    .limit(pageSize)
    .offset(offset);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      resid: r.resid,
      email: r.email ?? '',
      emailMasked: maskEmail(r.email),
      groupValue: r.groupValue,
      attrs: (r.attrs ?? {}) as Record<string, string>,
      respondedAt: r.respondedAt,
      latestResultCode: r.latestResultCode,
    })),
    total,
    page: clampedPage,
  };
}

export async function countCampaignCandidates(args: {
  surveyId: string;
  filter: CampaignFilterSnapshot;
}): Promise<number> {
  const where = buildCandidateWhere(args.surveyId, args.filter);
  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(contactTargets)
    .where(where);
  return countRow?.total ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// 수신거부자 명단 (캠페인 페이지 하단 세그먼트)
// ─────────────────────────────────────────────────────────────────────────────

export interface UnsubscribedContactRow {
  id: string;
  resid: number;
  emailMasked: string;
  groupValue: string | null;
  unsubscribedAt: Date;
}

export async function listUnsubscribedContacts(args: {
  surveyId: string;
  page?: number;
  pageSize?: number;
}): Promise<{ rows: UnsubscribedContactRow[]; total: number; page: number }> {
  const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;
  const where = and(
    eq(contactTargets.surveyId, args.surveyId),
    isNotNull(contactTargets.unsubscribedAt),
  )!;

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(contactTargets)
    .where(where);
  const total = countRow?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, args.page ?? 1), totalPages);
  const offset = (clampedPage - 1) * pageSize;

  const rows = await db
    .select({
      id: contactTargets.id,
      resid: contactTargets.resid,
      email: contactTargets.email,
      groupValue: contactTargets.groupValue,
      unsubscribedAt: contactTargets.unsubscribedAt,
    })
    .from(contactTargets)
    .where(where)
    .orderBy(desc(contactTargets.unsubscribedAt))
    .limit(pageSize)
    .offset(offset);

  return {
    rows: rows
      .filter((r): r is typeof r & { unsubscribedAt: Date } => r.unsubscribedAt !== null)
      .map((r) => ({
        id: r.id,
        resid: r.resid,
        emailMasked: maskEmail(r.email),
        groupValue: r.groupValue,
        unsubscribedAt: r.unsubscribedAt,
      })),
    total,
    page: clampedPage,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 분기 (마법사 ⑤ preflight) — 사용자 선택 명단과 현재 발송 가능 명단 비교
// ─────────────────────────────────────────────────────────────────────────────

export interface RecipientPreflightResult {
  validIds: string[]; // 발송 가능 (unsubscribed=null, email!=null)
  unsubscribedIds: string[]; // 사용자 선택 후 unsubscribed 로 전이됨
  emailMissingIds: string[]; // email 비어있음
  notFoundIds: string[]; // 컨택 삭제됨
}

export async function preflightRecipients(args: {
  surveyId: string;
  selectedContactIds: string[];
}): Promise<RecipientPreflightResult> {
  if (args.selectedContactIds.length === 0) {
    return { validIds: [], unsubscribedIds: [], emailMissingIds: [], notFoundIds: [] };
  }
  const rows = await db
    .select({
      id: contactTargets.id,
      email: contactTargets.email,
      unsubscribedAt: contactTargets.unsubscribedAt,
    })
    .from(contactTargets)
    .where(
      and(
        eq(contactTargets.surveyId, args.surveyId),
        inArray(contactTargets.id, args.selectedContactIds),
      ),
    );

  const validIds: string[] = [];
  const unsubscribedIds: string[] = [];
  const emailMissingIds: string[] = [];
  const found = new Set<string>();

  for (const r of rows) {
    found.add(r.id);
    if (r.unsubscribedAt !== null) {
      unsubscribedIds.push(r.id);
    } else if (!r.email || r.email.trim() === '') {
      emailMissingIds.push(r.id);
    } else {
      validIds.push(r.id);
    }
  }
  const notFoundIds = args.selectedContactIds.filter((id) => !found.has(id));

  return { validIds, unsubscribedIds, emailMissingIds, notFoundIds };
}

// ─────────────────────────────────────────────────────────────────────────────
// 미사용 import 경고 회피 (contactAttempts 는 sql template literal 안에서만 참조됨)
// ─────────────────────────────────────────────────────────────────────────────
void contactAttempts;
