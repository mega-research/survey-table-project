import 'server-only';

import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql, type SQL } from 'drizzle-orm';

import { db } from '@/db';
import {
  contactAttempts,
  contactPii,
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
import {
  buildNegativeCodeExists,
  getResultCodeStatuses,
} from '@/lib/operations/result-code-statuses.server';
import { buildContactsFilterSql } from '@/lib/operations/contacts-filter-sql';
import type { FilterClause } from '@/lib/operations/contacts-filters.server';

const DEFAULT_PAGE_SIZE = 20;

// ─────────────────────────────────────────────────────────────────────────────
// 단체 메일 list (메인 페이지)
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
// 단체 메일 detail
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
  /**
   * 발송 등록 시점에 자동 제외된 컨택 수 (atomic delta — 단체 메일 목록 카드에서 사용).
   * 단체 메일 상세에는 currentUnsubscribedCount(live query)를 노출.
   */
  skippedUnsubscribedCount: number;
  /**
   * 이 단체 메일 발송 대상 중 *현재* 수신거부 상태인 인원.
   * 발송 후 수신자가 footer 링크로 해지한 경우까지 포함 — 단체 메일 결과 분석용.
   */
  currentUnsubscribedCount: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  createdBy: string | null;
}

export async function getCampaignDetail(cid: string): Promise<CampaignDetail | null> {
  // count 쿼리는 부수 정보 — 실패해도 페이지 전체를 죽이지 않도록 0 fallback.
  // skipped_unsubscribed 상태는 발송 시도조차 없었으므로 "발송 대상 중 수신거부 응답"
  // 의미에서 제외 — 등록 시점 스킵은 skippedUnsubscribedCount(목록 카드)가 별도 표현.
  const [campaignRows, currentUnsubscribedCount] = await Promise.all([
    db
      .select({
        campaign: mailCampaigns,
        templateName: mailTemplates.name,
      })
      .from(mailCampaigns)
      .leftJoin(mailTemplates, eq(mailCampaigns.mailTemplateId, mailTemplates.id))
      .where(eq(mailCampaigns.id, cid))
      .limit(1),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(mailRecipients)
      .innerJoin(contactTargets, eq(contactTargets.id, mailRecipients.contactTargetId))
      .where(
        and(
          eq(mailRecipients.campaignId, cid),
          isNotNull(contactTargets.unsubscribedAt),
          ne(mailRecipients.status, 'skipped_unsubscribed'),
        ),
      )
      .then((rows) => rows[0]?.count ?? 0)
      .catch(() => 0),
  ]);
  const row = campaignRows[0];
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
    currentUnsubscribedCount,
    startedAt: c.startedAt,
    completedAt: c.completedAt,
    createdAt: c.createdAt,
    createdBy: c.createdBy,
  };
}

// 단체 메일 detail 의 recipients 목록 (status 필터 + email 검색 + 페이지네이션)
export interface CampaignRecipientRow {
  id: string;
  contactTargetId: string;
  contactResid: number;
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
      contactUnsubscribedAt: contactTargets.unsubscribedAt,
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
      unsubscribedAt: r.contactUnsubscribedAt,
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
// 컨택 페이지의 listContactsForSurvey 와 비슷하지만 단체 메일 발송 가능 조건 강제:
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

// "이 컨택에 email PII 가 등록돼 있나" 정확검사. NULL/'' 무관 — contact_pii row 존재 자체가 기준.
const HAS_EMAIL_PII = sql`EXISTS (
  SELECT 1 FROM contact_pii cp
  WHERE cp.contact_target_id = "contact_targets"."id"
    AND cp.field_type = 'email'
)`;

/**
 * 발송 가능 명단·preflight 양쪽에서 사용하는 negative 결과코드 제외 SQL.
 *
 * EXISTS 의 any-time 의미 — 한 회차라도 negative 코드 받으면 제외.
 * negative codes 빈 배열이면 TRUE [제외 안 함].
 *
 * unsubscribed_at 제외는 별도 isNull 조건으로 결합되므로 여기선 코드만 본다.
 */
function buildNotExcludedByNegativeCode(negativeCodes: string[]): SQL {
  // negative codes 가 비어 있을 때 EXISTS = FALSE → NOT(FALSE) = TRUE 로 자연 평가됨
  return sql`NOT ${buildNegativeCodeExists(negativeCodes, sql`"contact_targets"."id"`)}`;
}

/**
 * 발송 후보 WHERE — 다중 절 필터(조사대상목록과 동일) + 메일 발송 자동 제외 정책 결합.
 *
 * 항상 적용되는 자동 제외:
 *   - unsubscribed_at IS NULL (수신거부)
 *   - email PII 존재 (이메일 누락 제외)
 *   - 부정 결과코드 마킹 제외
 * + clauses (buildContactsFilterSql) + "미응답자만" 토글.
 *
 * clauses 의 PII blindIndex 는 호출자(page/action)의 parseClausesFromUrl 에서 이미
 * 계산되어 들어오므로 여기서는 비동기 PII 조회를 하지 않는다 → 동기 함수.
 */
function buildCandidateWhere(
  surveyId: string,
  clauses: FilterClause[],
  unrespondedOnly: boolean,
  negativeCodes: string[],
): SQL {
  const parts: SQL[] = [
    eq(contactTargets.surveyId, surveyId),
    isNull(contactTargets.unsubscribedAt),
    HAS_EMAIL_PII,
    buildNotExcludedByNegativeCode(negativeCodes),
    buildContactsFilterSql(clauses),
  ];

  if (unrespondedOnly) {
    parts.push(isNull(contactTargets.respondedAt));
  }

  return and(...parts)!;
}

/**
 * contact_id 목록에 대해 첫 email PII 의 mask_hint 일괄 조회.
 * 한 컨택에 여러 email 컬럼이 있으면 column_key 알파벳 순 첫 번째.
 */
async function fetchEmailMaskHints(contactIds: readonly string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (contactIds.length === 0) return result;

  const rows = await db
    .select({
      contactTargetId: contactPii.contactTargetId,
      columnKey: contactPii.columnKey,
      maskHint: contactPii.maskHint,
    })
    .from(contactPii)
    .where(
      and(
        eq(contactPii.fieldType, 'email'),
        inArray(contactPii.contactTargetId, [...contactIds]),
      ),
    )
    .orderBy(asc(contactPii.contactTargetId), asc(contactPii.columnKey));

  for (const r of rows) {
    if (result.has(r.contactTargetId)) continue; // 첫 컬럼만
    result.set(r.contactTargetId, r.maskHint ?? '');
  }
  return result;
}

const EMAIL_DASH = '—';

export async function previewCampaignCandidates(args: {
  surveyId: string;
  clauses: FilterClause[];
  unrespondedOnly: boolean;
  page?: number;
  pageSize?: number;
}): Promise<CampaignCandidatesResult> {
  const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;
  const { negative: negativeCodes } = await getResultCodeStatuses(args.surveyId);
  const where = buildCandidateWhere(args.surveyId, args.clauses, args.unrespondedOnly, negativeCodes);

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

  const maskMap = await fetchEmailMaskHints(rows.map((r) => r.id));

  return {
    rows: rows.map((r) => ({
      id: r.id,
      resid: r.resid,
      email: '', // candidate row 에서는 평문 비공개 — UI 는 emailMasked 만 표시
      emailMasked: maskMap.get(r.id) || EMAIL_DASH,
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
  clauses: FilterClause[];
  unrespondedOnly: boolean;
}): Promise<number> {
  const { negative: negativeCodes } = await getResultCodeStatuses(args.surveyId);
  const where = buildCandidateWhere(args.surveyId, args.clauses, args.unrespondedOnly, negativeCodes);
  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(contactTargets)
    .where(where);
  return countRow?.total ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// 수신거부자 명단 (단체 메일 페이지 하단 세그먼트)
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
      groupValue: contactTargets.groupValue,
      unsubscribedAt: contactTargets.unsubscribedAt,
    })
    .from(contactTargets)
    .where(where)
    .orderBy(desc(contactTargets.unsubscribedAt))
    .limit(pageSize)
    .offset(offset);

  const maskMap = await fetchEmailMaskHints(rows.map((r) => r.id));

  return {
    rows: rows
      .filter((r): r is typeof r & { unsubscribedAt: Date } => r.unsubscribedAt !== null)
      .map((r) => ({
        id: r.id,
        resid: r.resid,
        emailMasked: maskMap.get(r.id) || EMAIL_DASH,
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
  validIds: string[]; // 발송 가능 (unsubscribed=null, negative code 없음, email!=null)
  unsubscribedIds: string[]; // 사용자 선택 후 unsubscribed 로 전이됨
  excludedByCodeIds: string[]; // negative result_code 마킹으로 제외
  emailMissingIds: string[]; // email 비어있음
  notFoundIds: string[]; // 컨택 삭제됨
}

export async function preflightRecipients(args: {
  surveyId: string;
  selectedContactIds: string[];
}): Promise<RecipientPreflightResult> {
  if (args.selectedContactIds.length === 0) {
    return {
      validIds: [],
      unsubscribedIds: [],
      excludedByCodeIds: [],
      emailMissingIds: [],
      notFoundIds: [],
    };
  }

  const { negative: negativeCodes } = await getResultCodeStatuses(args.surveyId);

  // contact_targets + email PII 존재 여부 + negative code EXISTS 를 한 쿼리로.
  // 우선순위: unsubscribed → excludedByCode → !hasEmail → valid
  const rows = await db
    .select({
      id: contactTargets.id,
      unsubscribedAt: contactTargets.unsubscribedAt,
      hasEmail: sql<boolean>`EXISTS (
        SELECT 1 FROM contact_pii cp
        WHERE cp.contact_target_id = "contact_targets"."id"
          AND cp.field_type = 'email'
      )`.as('has_email'),
      excludedByCode: sql<boolean>`${buildNegativeCodeExists(
        negativeCodes,
        sql`"contact_targets"."id"`,
      )}`.as('excluded_by_code'),
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
  const excludedByCodeIds: string[] = [];
  const emailMissingIds: string[] = [];
  const found = new Set<string>();

  for (const r of rows) {
    found.add(r.id);
    // 우선순위: unsubscribed → excludedByCode → !hasEmail → valid
    if (r.unsubscribedAt !== null) {
      unsubscribedIds.push(r.id);
    } else if (r.excludedByCode) {
      excludedByCodeIds.push(r.id);
    } else if (!r.hasEmail) {
      emailMissingIds.push(r.id);
    } else {
      validIds.push(r.id);
    }
  }
  const notFoundIds = args.selectedContactIds.filter((id) => !found.has(id));

  return { validIds, unsubscribedIds, excludedByCodeIds, emailMissingIds, notFoundIds };
}

// ─────────────────────────────────────────────────────────────────────────────
// 미사용 import 경고 회피 (contactAttempts 는 sql template literal 안에서만 참조됨)
// ─────────────────────────────────────────────────────────────────────────────
void contactAttempts;
