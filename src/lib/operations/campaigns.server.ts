import 'server-only';

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';

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
import { decryptPii } from '@/lib/crypto/aes';
import { blindIndex } from '@/lib/crypto/blind';
import { maskEmail } from '@/lib/operations/contacts';
import {
  buildNegativeCodeExists,
  getResultCodeStatuses,
} from '@/lib/operations/result-code-statuses.server';
import {
  buildContactsFilterSql,
  latestResultCodeExpr,
} from '@/lib/operations/contacts-filter-sql';
import { escapeLikePattern, FILTER_NONE_VALUE } from '@/lib/operations/filter-shared';
import type { FilterClause } from '@/lib/operations/contacts-filters.server';
import {
  campaignScopeCondition,
  targetScopeCondition,
  testFlagForScope,
  type OperationsDataScope,
} from '@/lib/operations/data-scope.server';

const DEFAULT_PAGE_SIZE = 20;

// ─────────────────────────────────────────────────────────────────────────────
// 단체 메일 list (메인 페이지)
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

export interface ListCampaignsResult {
  rows: CampaignRow[];
  total: number;
  page: number;
}

export async function listCampaignsForSurvey(args: {
  surveyId: string;
  scope: OperationsDataScope;
  page?: number;
  pageSize?: number;
}): Promise<ListCampaignsResult> {
  const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;
  const where = and(
    eq(mailCampaigns.surveyId, args.surveyId),
    eq(mailCampaigns.kind, 'bulk'),
    campaignScopeCondition(args.scope),
    isNull(mailCampaigns.archivedAt),
  )!;

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
      isTest: mailCampaigns.isTest,
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

export async function getCampaignDetail(
  surveyId: string,
  cid: string,
  scope: OperationsDataScope,
): Promise<CampaignDetail | null> {
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
      .where(
        and(
          eq(mailCampaigns.id, cid),
          eq(mailCampaigns.surveyId, surveyId),
          campaignScopeCondition(scope),
          isNull(mailCampaigns.archivedAt),
        ),
      )
      .limit(1),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(mailRecipients)
      .innerJoin(mailCampaigns, eq(mailRecipients.campaignId, mailCampaigns.id))
      .innerJoin(contactTargets, eq(contactTargets.id, mailRecipients.contactTargetId))
      .where(
        and(
          eq(mailRecipients.campaignId, cid),
          isNotNull(contactTargets.unsubscribedAt),
          ne(mailRecipients.status, 'skipped_unsubscribed'),
          isNull(mailRecipients.archivedAt),
          campaignScopeCondition(scope),
          eq(mailCampaigns.surveyId, surveyId),
          isNull(mailCampaigns.archivedAt),
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
  contactTargetId: string | null;
  contactResid: number | null;
  contactGroupValue: string | null;
  /** 컨택 최신 회차의 result_code — 조사 대상 목록의 컨택결과 컬럼과 같은 값. */
  latestResultCode: string | null;
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

/**
 * 수신자 목록 깔때기가 보는 두 축의 표현식.
 * 빈 문자열은 NULL 과 같은 "없음" 으로 접는다 — 표가 둘 다 '—'/공백 으로 그리므로
 * 화면과 필터가 어긋나지 않게 하려면 여기서 합쳐야 한다.
 */
const RECIPIENT_GROUP_EXPR = sql`NULLIF(${contactTargets.groupValue}, '')`;
const RECIPIENT_ERROR_EXPR = sql`NULLIF(${mailRecipients.errorReason}, '')`;
// 컨택결과는 조사 대상 목록과 같은 표현식을 공유한다 — 두 화면이 같은 값을 보여야 한다.
// latestResultCodeExpr 는 "contact_targets"."id" 로 상관되므로 이 쿼리의 LEFT JOIN 별칭과 맞는다.
const RECIPIENT_RESULT_EXPR = sql`NULLIF(${latestResultCodeExpr}, '')`;

/**
 * 깔때기 값 목록 → WHERE 조건. FILTER_NONE_VALUE 는 IS NULL 로 승격시켜 OR 결합한다
 * (NULL 은 IN 목록으로 표현 불가). 값이 없으면 null 반환 = 조건 미부착(전체).
 */
function buildRecipientFacetCond(expr: SQL, values: string[] | undefined): SQL | null {
  if (!values || values.length === 0) return null;
  const concrete = values.filter((v) => v !== FILTER_NONE_VALUE);
  const includeNull = concrete.length !== values.length;
  const parts: SQL[] = [];
  if (concrete.length > 0) {
    parts.push(
      sql`${expr} IN (${sql.join(
        concrete.map((v) => sql`${v}`),
        sql`, `,
      )})`,
    );
  }
  if (includeNull) parts.push(sql`${expr} IS NULL`);
  if (parts.length === 0) return null;
  return sql`(${sql.join(parts, sql` OR `)})`;
}

export interface CampaignRecipientFacets {
  /** 이 캠페인 수신자에 실제로 등장하는 그룹 값 (NULL 제외, 오름차순) */
  groupValues: string[];
  /** 이 캠페인 수신자에 실제로 등장하는 반송/실패 사유 (NULL 제외, 오름차순) */
  errorReasons: string[];
  /** 이 캠페인 수신자에 실제로 등장하는 컨택결과 코드 (NULL 제외, 오름차순) */
  resultCodes: string[];
  /** 그룹 없음 행이 존재하는지 — 빈 값 선택지 노출 판단용 */
  hasEmptyGroup: boolean;
  /** 사유 없음 행이 존재하는지 */
  hasEmptyError: boolean;
  /** 컨택결과 없음 행이 존재하는지 */
  hasEmptyResult: boolean;
}

/** 깔때기 체크박스 목록이 너무 길어지지 않도록 하는 상한. 초과분은 잘라서 노출한다. */
const FACET_LIMIT = 200;

/**
 * 수신자 목록 깔때기의 distinct 값 목록.
 *
 * 필터 자체와 같은 scope·archived 가드를 걸되 현재 걸린 깔때기 조건은 빼고 센다 —
 * 엑셀 오토필터처럼 "지금 고를 수 있는 값 전체" 를 보여주기 위함이다. 조건을 함께
 * 걸면 한 값을 고르는 순간 나머지 선택지가 사라져 해제 외에는 조작이 불가능해진다.
 */
export async function listCampaignRecipientFacets(args: {
  surveyId: string;
  campaignId: string;
  scope: OperationsDataScope;
}): Promise<CampaignRecipientFacets> {
  const where = and(
    eq(mailRecipients.campaignId, args.campaignId),
    eq(mailCampaigns.surveyId, args.surveyId),
    campaignScopeCondition(args.scope),
    isNull(mailCampaigns.archivedAt),
    isNull(mailRecipients.archivedAt),
  )!;

  /**
   * 축 하나의 distinct 값 + 빈 값 존재 여부.
   *
   * 축을 합쳐 한 번에 DISTINCT 하면 (그룹 × 사유 × 결과코드) 조합 수만큼 행이 나온다.
   * 반송 사유처럼 행마다 거의 고유한 값이 섞이면 수신자 수만큼이 그대로 앱으로 넘어오므로,
   * 축별로 나눠 LIMIT 을 SQL 에 내려 전송량을 상한에 묶는다.
   *
   * NULLS FIRST 는 hasEmpty 판정을 LIMIT 에서 보호한다 — 빈 값이 창 밖으로 밀리면
   * 실제로는 있는 "없음" 선택지가 사라진다.
   */
  const facetOf = async (expr: SQL): Promise<{ values: string[]; hasEmpty: boolean }> => {
    const rows = await db
      .selectDistinct({ v: sql<string | null>`${expr}` })
      .from(mailRecipients)
      .innerJoin(mailCampaigns, eq(mailRecipients.campaignId, mailCampaigns.id))
      .leftJoin(contactTargets, eq(mailRecipients.contactTargetId, contactTargets.id))
      .where(where)
      // ORDER BY 1 (위치 지정) 필수 — 식을 다시 쓰면 DISTINCT select list 와 다른 식으로
      // 취급돼 PG 가 거부한다 (contact-attr-values.service 와 같은 함정).
      .orderBy(sql`1 ASC NULLS FIRST`)
      .limit(FACET_LIMIT + 2);

    const hasEmpty = rows.some((r) => r.v == null);
    const values = rows
      .map((r) => r.v)
      // 센티널과 같은 실제 값은 선택지에서 제외한다 — 노출하면 파서가 빈 값으로 승격시켜
      // 화면에 보이는 값과 다른 행이 걸린다 (FILTER_NONE_VALUE 주석 참조).
      .filter((v): v is string => v != null && v !== FILTER_NONE_VALUE)
      .sort((a, b) => a.localeCompare(b, 'ko-KR'))
      .slice(0, FACET_LIMIT);
    return { values, hasEmpty };
  };

  const [group, error, result] = await Promise.all([
    facetOf(RECIPIENT_GROUP_EXPR),
    facetOf(RECIPIENT_ERROR_EXPR),
    facetOf(RECIPIENT_RESULT_EXPR),
  ]);

  return {
    groupValues: group.values,
    errorReasons: error.values,
    resultCodes: result.values,
    hasEmptyGroup: group.hasEmpty,
    hasEmptyError: error.hasEmpty,
    hasEmptyResult: result.hasEmpty,
  };
}

export async function listCampaignRecipients(args: {
  surveyId: string;
  campaignId: string;
  scope: OperationsDataScope;
  page?: number;
  pageSize?: number;
  /** 필터할 status 목록. 빈 배열 또는 미지정 = 전체. */
  statuses?: MailRecipientStatus[];
  q?: string;
  /** 깔때기 — contact_targets.group_value. FILTER_NONE_VALUE 는 그룹 없음(NULL). */
  groupValues?: string[];
  /** 깔때기 — mail_recipients.error_reason. FILTER_NONE_VALUE 는 사유 없음(NULL/빈 문자열). */
  errorReasons?: string[];
  /** 깔때기 — 컨택 최신 회차 result_code. FILTER_NONE_VALUE 는 결과 없음(NULL). */
  resultCodes?: string[];
}): Promise<ListCampaignRecipientsResult> {
  const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;
  const whereParts: SQL[] = [
    eq(mailRecipients.campaignId, args.campaignId),
    eq(mailCampaigns.surveyId, args.surveyId),
    campaignScopeCondition(args.scope),
    isNull(mailCampaigns.archivedAt),
    isNull(mailRecipients.archivedAt),
  ];

  if (args.statuses && args.statuses.length > 0) {
    whereParts.push(inArray(mailRecipients.status, args.statuses));
  }
  const q = (args.q ?? '').trim();
  if (q) {
    const escaped = escapeLikePattern(q);
    whereParts.push(sql`${mailRecipients.emailSnapshot} ILIKE ${'%' + escaped + '%'}`);
  }
  const groupCond = buildRecipientFacetCond(RECIPIENT_GROUP_EXPR, args.groupValues);
  if (groupCond) whereParts.push(groupCond);
  const errorCond = buildRecipientFacetCond(RECIPIENT_ERROR_EXPR, args.errorReasons);
  if (errorCond) whereParts.push(errorCond);
  const resultCond = buildRecipientFacetCond(RECIPIENT_RESULT_EXPR, args.resultCodes);
  if (resultCond) whereParts.push(resultCond);
  const where = and(...whereParts)!;

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(mailRecipients)
    .innerJoin(mailCampaigns, eq(mailRecipients.campaignId, mailCampaigns.id))
    // where 가 컨택 상관 조건(그룹·최근 결과코드)을 담을 수 있으므로 행 조회와 같은
    // 조인 집합을 가져야 한다. 빠뜨리면 PG 가 missing FROM-clause entry 로 거절한다.
    .leftJoin(contactTargets, eq(mailRecipients.contactTargetId, contactTargets.id))
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
      contactLatestResultCode: sql<string | null>`${RECIPIENT_RESULT_EXPR}`,
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
    .innerJoin(mailCampaigns, eq(mailRecipients.campaignId, mailCampaigns.id))
    .leftJoin(contactTargets, eq(mailRecipients.contactTargetId, contactTargets.id))
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
      latestResultCode: r.contactLatestResultCode,
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
  /** 가장 최근 단체 메일에서의 수신 status. 발송 이력 없으면 null — 재전송 명단 대조용. */
  latestMailStatus: MailRecipientStatus | null;
}

export interface CampaignCandidatesResult {
  rows: CampaignCandidateRow[];
  total: number;
  page: number;
  /** 필터 base 안에서 자동 제외 정책에 걸린 인원 (사유별, 중복 없음) */
  exclusions: CampaignExclusionCounts;
}

/** 미리보기 정렬 — 번호 / 응답여부 / 수신 상황 / 최근 결과코드. 이메일·그룹은 PII·비용 사유로 제외. */
export type CampaignSortKey = 'resid' | 'responded' | 'mailStatus' | 'resultCode';
export type CampaignSortDir = 'asc' | 'desc';

export const CAMPAIGN_SORT_KEYS: readonly CampaignSortKey[] = [
  'resid',
  'responded',
  'mailStatus',
  'resultCode',
];

/**
 * 컨택별 최근 수신 status 스칼라 서브쿼리 — 미리보기 "수신 상황" 컬럼용.
 * 최근 = 수신자 row 생성(큐잉) 시각 기준. archived 단체 메일/수신자는 제외하고,
 * 테스트 모드 스코프(is_test)를 맞춰 실발송·테스트 이력이 섞이지 않게 한다.
 */
function latestMailStatusExpr(scope: OperationsDataScope): SQL<MailRecipientStatus | null> {
  return sql<MailRecipientStatus | null>`(
    SELECT mr.status FROM mail_recipients mr
    JOIN mail_campaigns mc ON mc.id = mr.campaign_id
    WHERE mr.contact_target_id = "contact_targets"."id"
      AND mr.archived_at IS NULL
      AND mc.archived_at IS NULL
      AND mc.is_test = ${testFlagForScope(scope)}
    ORDER BY mr.created_at DESC
    LIMIT 1
  )`;
}

/**
 * 수신 상황 정렬 랭크 — 발송 파이프라인 진행 순으로 숫자화.
 * asc = 대기→전송중→발송됨→전달→열람→수신거부스킵→반송→신고→실패,
 * desc 는 역순(오류 계열 먼저). 발송 이력 없음(null)은 방향 무관 항상 뒤(NULLS LAST).
 */
function mailStatusRankExpr(scope: OperationsDataScope): SQL<number | null> {
  return sql<number | null>`(CASE ${latestMailStatusExpr(scope)}
    WHEN 'queued' THEN 1
    WHEN 'sending' THEN 2
    WHEN 'sent' THEN 3
    WHEN 'delivered' THEN 4
    WHEN 'opened' THEN 5
    WHEN 'skipped_unsubscribed' THEN 6
    WHEN 'bounced' THEN 7
    WHEN 'complained' THEN 8
    WHEN 'failed' THEN 9
  END)`;
}

// "이 컨택에 email PII 가 등록돼 있나" 정확검사. NULL/'' 무관 — contact_pii row 존재 자체가 기준.
const HAS_EMAIL_PII = sql`EXISTS (
  SELECT 1 FROM contact_pii cp
  WHERE cp.contact_target_id = "contact_targets"."id"
    AND cp.field_type = 'email'
)`;

/**
 * 이 설문에서 반송된 주소의 blind index 집합.
 *
 * 설문 스코프를 contact_targets 가 아니라 mail_campaigns.survey_id 로 잡는다 —
 * 조사대상자 교체 업로드는 contact_targets 를 통째로 DELETE 하고
 * mail_recipients.contact_target_id 는 ON DELETE SET NULL 이라, 컨택 기준으로 좁히면
 * 교체 직후 반송 이력이 통째로 사라진다. email_snapshot 은 컨택 삭제와 무관하게 남으므로
 * 주소 기준 판정은 교체를 넘어 보존된다.
 */
async function listBouncedEmailBlindIndexes(surveyId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ emailSnapshot: mailRecipients.emailSnapshot })
    .from(mailRecipients)
    .innerJoin(mailCampaigns, eq(mailRecipients.campaignId, mailCampaigns.id))
    .where(
      and(
        eq(mailCampaigns.surveyId, surveyId),
        eq(mailRecipients.status, 'bounced'),
      ),
    );

  const blinds = new Set<string>();
  for (const r of rows) {
    if (!r.emailSnapshot) continue; // snapshot 이 비면 대조 불가
    const blind = blindIndex('email', r.emailSnapshot);
    if (blind) blinds.add(blind); // 정규화 후 빈 값도 대조 불가
  }
  return [...blinds];
}

/**
 * 반송 이력으로 발송에서 자동 제외할 컨택 id 목록.
 *
 * 반송(bounced)은 컨택이 아니라 "주소"의 속성이다 — 하드바운스 주소에 재발송하면
 * 발신 도메인 평판이 깎이므로 반송된 주소를 아직 쓰는 컨택만 제외한다. 관리자가 이메일을
 * 수정하거나 병합 업로드로 주소가 바뀌면 대조가 어긋나 자동으로 다시 발송 대상이 된다.
 *
 * sent(미확정) 상태는 배달 시도 중일 뿐이므로 제외 대상이 아니다.
 * 미리보기 목록에서는 제외하지 않는다 — 발송 시점(preflight·createCampaign)에만 적용.
 * 단건 발송에는 적용하지 않는다 — 관리자가 특정 컨택을 지목한 의도적 발송이므로 반송
 * 주소여도 허용한다 (2026-08-13 결정). 단건은 createCampaign(kind='single') 경로를
 * 재사용하므로 스킵은 createCampaign 내부에서 kind 로 분기한다.
 */
export async function listBouncedContactIds(surveyId: string): Promise<string[]> {
  const blinds = await listBouncedEmailBlindIndexes(surveyId);
  if (blinds.length === 0) return [];

  // 발송이 쓰는 주소의 근사치를 대조한다 — createCampaign 은 contact_pii 를 column_key
  // 오름차순으로 훑되(mail-campaigns.service.ts 의 asc(contactPii.columnKey)), 첫 email 컬럼의
  // 복호화가 실패하거나 결과가 공백이면 다음 컬럼으로 폴백한다. 이 서브쿼리는 그 폴백을
  // 모델링하지 않고 단순 column_key 최솟값만 본다 — 복호화 가능 여부는 SQL 술어로 표현할 수
  // 없고, 정확히 맞추려면 설문 전체 컨택의 cipher 를 매번 복호화해야 해서 preflight 비용이
  // 과다하기 때문이다. 그 갭 때문에 첫 컬럼이 실제로 사용 불가능해 두 번째 컬럼으로 발송된
  // 컨택은, 그 두 번째 주소가 반송돼도 이 판정으로는 제외되지 않는다(cipher 손상·키 미스매치
  // 등 좁은 조건에서만 발동). 발송 쪽 선택 규칙이 바뀌면 아래 서브쿼리도 함께 바꿔야 한다.
  const sendAddressBlind = sql`(
    SELECT cp.blind_index
    FROM contact_pii cp
    WHERE cp.contact_target_id = ${contactTargets.id}
      AND cp.field_type = 'email'
    ORDER BY cp.column_key
    LIMIT 1
  )`;

  const rows = await db
    .select({ id: contactTargets.id })
    .from(contactTargets)
    .where(
      and(
        eq(contactTargets.surveyId, surveyId),
        inArray(sendAddressBlind, blinds),
      ),
    );

  return rows.map((r) => r.id);
}

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
 * 반송 이력 컨택은 미리보기 명단에는 그대로 표시하고 발송 시점(preflight·
 * createCampaign)에만 제외한다 — 목록에서 조용히 사라지면 명단 대조가 어렵다.
 *
 * clauses 의 PII blindIndex 는 호출자(page/action)의 parseClausesFromUrl 에서 이미
 * 계산되어 들어오므로 여기서는 비동기 PII 조회를 하지 않는다 → 동기 함수.
 */
function buildCandidateWhere(
  surveyId: string,
  scope: OperationsDataScope,
  clauses: FilterClause[],
  unrespondedOnly: boolean,
  negativeCodes: string[],
): SQL {
  const parts: SQL[] = [
    eq(contactTargets.surveyId, surveyId),
    targetScopeCondition(scope),
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
 * 필터 base(clauses + 미응답자만) 안에서 발송 자동 제외 정책에 걸린 인원을 사유별로 센다.
 *
 * 사유는 우선순위 귀속으로 중복 없이 하나만 부여한다:
 *   수신거부 → 부정 결과코드 → 이메일 누락 → 반송 이력
 * 수신거부·부정 결과코드·이메일 누락은 미리보기 목록에서도 빠지고, 반송 이력은
 * 목록에는 남되 발송 시점에 제외된다 (buildCandidateWhere 주석 참조).
 */
async function countCandidateExclusions(
  surveyId: string,
  scope: OperationsDataScope,
  clauses: FilterClause[],
  unrespondedOnly: boolean,
  negativeCodes: string[],
  bouncedContactIds: readonly string[],
): Promise<CampaignExclusionCounts> {
  const baseParts: SQL[] = [
    eq(contactTargets.surveyId, surveyId),
    targetScopeCondition(scope),
    buildContactsFilterSql(clauses),
  ];
  if (unrespondedOnly) {
    baseParts.push(isNull(contactTargets.respondedAt));
  }

  const negExists = buildNegativeCodeExists(negativeCodes, sql`"contact_targets"."id"`);
  const bouncedCond: SQL =
    bouncedContactIds.length > 0
      ? inArray(contactTargets.id, [...bouncedContactIds])
      : sql`FALSE`;

  const [row] = await db
    .select({
      unsubscribed: sql<number>`count(*) FILTER (WHERE ${contactTargets.unsubscribedAt} IS NOT NULL)::int`,
      negativeCode: sql<number>`count(*) FILTER (WHERE ${contactTargets.unsubscribedAt} IS NULL AND ${negExists})::int`,
      emailMissing: sql<number>`count(*) FILTER (WHERE ${contactTargets.unsubscribedAt} IS NULL AND NOT ${negExists} AND NOT ${HAS_EMAIL_PII})::int`,
      bounced: sql<number>`count(*) FILTER (WHERE ${contactTargets.unsubscribedAt} IS NULL AND NOT ${negExists} AND ${HAS_EMAIL_PII} AND ${bouncedCond})::int`,
    })
    .from(contactTargets)
    .where(and(...baseParts)!);

  return row ?? { unsubscribed: 0, negativeCode: 0, emailMissing: 0, bounced: 0 };
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

/**
 * 미리보기 정렬 컬럼 매핑. id tiebreaker 는 호출부에서 추가.
 *
 * 응답여부는 미응답(respondedAt NULL) ↔ 응답완료 그룹 토글이 목적이므로 방향에 따라
 * NULL 위치를 바꾼다 — asc=미응답 먼저, desc=응답완료(최신) 먼저.
 * resid·수신 상황·결과코드는 NULL(이력 없음) 을 항상 뒤로(NULLS LAST).
 */
function buildCandidateOrderBy(
  sort: CampaignSortKey,
  dir: CampaignSortDir,
  scope: OperationsDataScope,
): SQL {
  if (sort === 'responded') {
    return dir === 'asc'
      ? sql`${contactTargets.respondedAt} ASC NULLS FIRST`
      : sql`${contactTargets.respondedAt} DESC NULLS LAST`;
  }
  const col =
    sort === 'resultCode'
      ? latestResultCodeExpr
      : sort === 'mailStatus'
        ? mailStatusRankExpr(scope)
        : sql`${contactTargets.resid}`;
  return dir === 'asc' ? sql`${col} ASC NULLS LAST` : sql`${col} DESC NULLS LAST`;
}

export async function previewCampaignCandidates(args: {
  surveyId: string;
  scope: OperationsDataScope;
  clauses: FilterClause[];
  unrespondedOnly: boolean;
  sort?: CampaignSortKey;
  dir?: CampaignSortDir;
  page?: number;
  pageSize?: number;
}): Promise<CampaignCandidatesResult> {
  const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;
  const [{ negative: negativeCodes }, bouncedContactIds] = await Promise.all([
    getResultCodeStatuses(args.surveyId),
    listBouncedContactIds(args.surveyId),
  ]);
  // 반송 컨택은 목록에 포함 — bouncedContactIds 는 exclusions 카운트(발송 시 제외 예고)에만 사용.
  const where = buildCandidateWhere(
    args.surveyId,
    args.scope,
    args.clauses,
    args.unrespondedOnly,
    negativeCodes,
  );

  const [[countRow], exclusions] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(contactTargets)
      .where(where),
    countCandidateExclusions(
      args.surveyId,
      args.scope,
      args.clauses,
      args.unrespondedOnly,
      negativeCodes,
      bouncedContactIds,
    ),
  ]);
  const total = countRow?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, args.page ?? 1), totalPages);
  const offset = (clampedPage - 1) * pageSize;

  const rows = await db
    .select({
      id: contactTargets.id,
      resid: contactTargets.resid,
      groupValue: contactTargets.groupValue,
      attrs: contactTargets.attrs,
      respondedAt: contactTargets.respondedAt,
      latestResultCode: latestResultCodeExpr.as('latest_result_code'),
      latestMailStatus: latestMailStatusExpr(args.scope).as('latest_mail_status'),
    })
    .from(contactTargets)
    .where(where)
    .orderBy(
      buildCandidateOrderBy(args.sort ?? 'resid', args.dir ?? 'asc', args.scope),
      asc(contactTargets.id),
    )
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
      latestMailStatus: r.latestMailStatus,
    })),
    total,
    page: clampedPage,
    exclusions,
  };
}

export async function countCampaignCandidates(args: {
  surveyId: string;
  scope: OperationsDataScope;
  clauses: FilterClause[];
  unrespondedOnly: boolean;
}): Promise<number> {
  const { negative: negativeCodes } = await getResultCodeStatuses(args.surveyId);
  const where = buildCandidateWhere(
    args.surveyId,
    args.scope,
    args.clauses,
    args.unrespondedOnly,
    negativeCodes,
  );
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
  scope: OperationsDataScope;
  page?: number;
  pageSize?: number;
}): Promise<{ rows: UnsubscribedContactRow[]; total: number; page: number }> {
  const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;
  const where = and(
    eq(contactTargets.surveyId, args.surveyId),
    targetScopeCondition(args.scope),
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
  validIds: string[]; // 발송 가능 (unsubscribed=null, negative code 없음, email!=null, 반송 이력 없음)
  unsubscribedIds: string[]; // 사용자 선택 후 unsubscribed 로 전이됨
  excludedByCodeIds: string[]; // negative result_code 마킹으로 제외
  emailMissingIds: string[]; // email 비어있음
  bouncedIds: string[]; // 반송 이력 (현재 주소 기준) 으로 제외
  notFoundIds: string[]; // 컨택 삭제됨
}

export async function preflightRecipients(args: {
  surveyId: string;
  scope: OperationsDataScope;
  selectedContactIds: string[];
  /** listBouncedContactIds 결과 — 호출자가 계산해 주입 (createCampaign 재검증과 공유) */
  bouncedContactIds: readonly string[];
}): Promise<RecipientPreflightResult> {
  if (args.selectedContactIds.length === 0) {
    return {
      validIds: [],
      unsubscribedIds: [],
      excludedByCodeIds: [],
      emailMissingIds: [],
      bouncedIds: [],
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
        targetScopeCondition(args.scope),
        inArray(contactTargets.id, args.selectedContactIds),
      ),
    );

  const validIds: string[] = [];
  const unsubscribedIds: string[] = [];
  const excludedByCodeIds: string[] = [];
  const emailMissingIds: string[] = [];
  const bouncedIds: string[] = [];
  const bouncedSet = new Set(args.bouncedContactIds);
  const found = new Set<string>();

  // 1차 분류 — unsubscribed / excludedByCode / contact_pii row 부재(!hasEmail) / 반송 이력까지.
  // hasEmail 통과분은 cipher 복호화로 2차 검증한다 (아래 참조).
  const decryptCandidateIds: string[] = [];
  for (const r of rows) {
    found.add(r.id);
    // 우선순위: unsubscribed → excludedByCode → !hasEmail → bounced → (복호화 검증) → valid
    if (r.unsubscribedAt !== null) {
      unsubscribedIds.push(r.id);
    } else if (r.excludedByCode) {
      excludedByCodeIds.push(r.id);
    } else if (!r.hasEmail) {
      emailMissingIds.push(r.id);
    } else if (bouncedSet.has(r.id)) {
      bouncedIds.push(r.id);
    } else {
      // contact_pii row 는 있으나 cipher 가 빈 문자열/공백으로 복호화되거나 복호화에
      // 실패하는 컨택은 createCampaign 에서 발송 대상에서 빠진다(line 137~145). preflight
      // 도 동일 기준으로 검증해야 "실제 발송" 카운트가 실제 큐잉 수와 일치한다 — 그렇지
      // 않으면 valid 가 과대 보고되고 그 차이가 skippedUnsubscribedCount 로 흡수된다.
      decryptCandidateIds.push(r.id);
    }
  }

  if (decryptCandidateIds.length > 0) {
    const usableIds = await fetchContactIdsWithUsableEmail(decryptCandidateIds);
    for (const id of decryptCandidateIds) {
      if (usableIds.has(id)) {
        validIds.push(id);
      } else {
        emailMissingIds.push(id);
      }
    }
  }

  const notFoundIds = args.selectedContactIds.filter((id) => !found.has(id));

  return { validIds, unsubscribedIds, excludedByCodeIds, emailMissingIds, bouncedIds, notFoundIds };
}

/**
 * 주어진 컨택 id 중 "발송 가능한 email cipher" 를 가진 id Set 반환.
 *
 * createCampaign(mail-campaigns.service.ts) 의 발송 명단 산출과 동일 기준:
 *   - 한 컨택에 email 컬럼이 여러 개면 column_key 알파벳 순으로 훑어
 *     "복호화에 성공한(빈 문자열/공백 아님) 첫 컬럼" 을 발송 email 로 채택.
 *   - 첫 컬럼이 blank/공백/복호화 실패면 다음 컬럼으로 폴백한다.
 *   - 어떤 컬럼도 usable 하지 않으면 제외.
 *
 * preflight 가 EXISTS(contact_pii) 만으로 valid 를 세면 위 케이스를 놓쳐 과대 보고하므로,
 * 후보(EXISTS 통과)에 한해 실제 복호화로 재검증한다. send path 가 SoT 이므로
 * "첫 usable 컬럼" 폴백 동작까지 동일하게 맞춰야 큐잉 수와 preflight 카운트가 일치한다.
 */
async function fetchContactIdsWithUsableEmail(
  contactIds: readonly string[],
): Promise<Set<string>> {
  const usable = new Set<string>();
  if (contactIds.length === 0) return usable;

  const rows = await db
    .select({
      contactTargetId: contactPii.contactTargetId,
      columnKey: contactPii.columnKey,
      cipher: contactPii.cipher,
    })
    .from(contactPii)
    .where(
      and(
        eq(contactPii.fieldType, 'email'),
        inArray(contactPii.contactTargetId, [...contactIds]),
      ),
    )
    .orderBy(asc(contactPii.contactTargetId), asc(contactPii.columnKey));

  // send path(createCampaign) 와 동일하게 "첫 usable 컬럼" 폴백:
  // blank/공백/복호화 실패 컬럼에서는 seen 을 마킹하지 않고 다음 컬럼으로 넘어간다.
  // 한 컨택이라도 usable 컬럼이 하나 나오면 그 시점에만 seen 처리해 중복을 차단한다.
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.contactTargetId)) continue; // 이미 usable 컬럼을 찾은 컨택
    try {
      const email = decryptPii(r.cipher);
      if (email && email.trim()) {
        usable.add(r.contactTargetId);
        seen.add(r.contactTargetId);
      }
    } catch {
      // 복호화 실패 컬럼은 건너뛰고 다음 컬럼으로 폴백 (seen 미마킹)
    }
  }
  return usable;
}

// ─────────────────────────────────────────────────────────────────────────────
// 미사용 import 경고 회피 (contactAttempts 는 sql template literal 안에서만 참조됨)
// ─────────────────────────────────────────────────────────────────────────────
void contactAttempts;
