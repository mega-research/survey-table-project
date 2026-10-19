import { type SQL, and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import {
  contactAttempts,
  contactTargets,
  mailCampaigns,
  mailRecipients,
  mailTemplates,
} from '@/db/schema';
import type { MailEmailOrder } from '@/lib/contacts/mail-email-order';
import { getMaskHintsForTargets } from '@/lib/crypto/contact-pii-repo';
import { maskEmail } from '@/lib/operations/contacts-format';
import {
  type BouncedAddresses,
  allCandidatesBouncedSql,
  firstEmailRowByTarget,
  hasEmailCandidateSql,
  loadBouncedAddresses,
  loadMailEmailOrder,
  loadMailEmailOrders,
  resolveSendAddresses,
  selectEmailPiiRows,
} from '@/server/read-models/send-address';
import {
  buildNegativeCodeExists,
  getResultCodeStatuses,
} from '@/server/read-models/result-code-statuses';
import {
  buildContactsFilterSql,
  latestResultCodeExpr,
  latestResultUnsubscribedSql,
  matchedResponseSubquery,
} from '@/lib/operations/contacts-filter-sql.server';
import {
  FILTER_NONE_VALUE,
  UNSUBSCRIBE_RESULT_CODE_KEYWORD,
  escapeLikePattern,
  isUnsubscribeResultCode,
} from '@/lib/operations/filter-shared';
import {
  type OperationsDataScope,
  campaignScopeCondition,
  targetScopeCondition,
  testFlagForScope,
} from '@/server/data-scope';
import type { FilterClause } from '@/lib/operations/filter-shared';
import type { ResolvedContactFilter } from '@/server/read-models/contact-filter-resolution';
import type {
  CampaignFilterSnapshot,
  MailAttachment,
  MailCampaignKind,
  MailCampaignStatus,
  MailRecipientStatus,
} from '@/shared/contracts/mail';
import type {
  CampaignCandidateRow,
  CampaignExclusionCounts,
  CampaignRecipientRow,
  CampaignRow,
  CampaignSortDir,
  CampaignSortKey,
  UnsubscribedContactRow,
} from '@/shared/contracts/mail-io';

// 표가 props 로 받는 행 모양은 계약(@/shared/contracts/mail-io) 소관 — 여기서 다시 내보내
// 기존 호출부(RSC·app 라우트)의 import 경로를 유지한다.
export type {
  CampaignCandidateRow,
  CampaignExclusionCounts,
  CampaignRecipientRow,
  CampaignRow,
  CampaignSortDir,
  CampaignSortKey,
  UnsubscribedContactRow,
};

const DEFAULT_PAGE_SIZE = 20;

// ─────────────────────────────────────────────────────────────────────────────
// 단체 메일 list (메인 페이지)
// ─────────────────────────────────────────────────────────────────────────────

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
    // 대체 발송(실패·반송 뒤 다음 순위 주소로 자동 재발송) 회차도 목록에 함께 보인다. 단건은 컨택 상세에.
    inArray(mailCampaigns.kind, ['bulk', 'fallback']),
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
      kind: mailCampaigns.kind,
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
  kind: MailCampaignKind;
  /** 대체 발송 회차면 원래(부모) 회차 */
  parentCampaignId: string | null;
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
  // 수신거부 판정은 수신자 탭 필터와 같은 축(메일 해지 OR 최근 결과코드 수신거부).
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
          or(
            isNotNull(contactTargets.unsubscribedAt),
            sql`${RECIPIENT_RESULT_EXPR} LIKE '%' || ${UNSUBSCRIBE_RESULT_CODE_KEYWORD} || '%'`,
          ),
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
    kind: c.kind,
    parentCampaignId: c.parentCampaignId,
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

/**
 * 대상이 지금 맡겨진 컨택원 이름(메일 표의 컨택원 열). 꺼져 있으면 읽지 않고 NULL —
 * 게스트 화면은 켜지 않는다. contact_targets 와 상관되므로 세 표의 FROM 이 그 테이블이어야 한다.
 */
function assignmentNameExpr(include: boolean | undefined) {
  return include
    ? sql<string | null>`(SELECT name FROM contact_assignments WHERE id = "contact_targets".assignment_id)`
    : sql<string | null>`NULL::text`;
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
  /** 메일 표시를 켠 개인정보 열 — 이 열들의 마스킹 힌트만 행에 싣는다. 비면 읽지 않는다. */
  piiMaskKeys?: readonly string[];
  /** 컨택원 이름을 행에 싣는가 — 컨택원 열을 메일 표시로 켠 비게스트 화면만 켠다. */
  includeAssignment?: boolean;
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
    // '수신거부' 탭(skipped_unsubscribed)은 발송 스킵 상태만으로는 발송 후
    // 수신거부자를 놓친다 — 행의 수신거부 badge 와 같은 판정이 되도록 메일 해지
    // (contact_targets.unsubscribed_at)와 최근 결과코드 수신거부를 OR 로 결합한다.
    const statusCond = args.statuses.includes('skipped_unsubscribed')
      ? or(
          inArray(mailRecipients.status, args.statuses),
          isNotNull(contactTargets.unsubscribedAt),
          sql`${RECIPIENT_RESULT_EXPR} LIKE '%' || ${UNSUBSCRIBE_RESULT_CODE_KEYWORD} || '%'`,
        )!
      : inArray(mailRecipients.status, args.statuses);
    whereParts.push(statusCond);
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
      contactAttrs: contactTargets.attrs,
      contactAssignmentName: assignmentNameExpr(args.includeAssignment),
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

  const piiMasks = await fetchPiiMasks(
    rows.flatMap((r) => (r.contactTargetId ? [r.contactTargetId] : [])),
    args.piiMaskKeys,
  );

  return {
    rows: rows.map((r) => ({
      id: r.id,
      contactTargetId: r.contactTargetId,
      contactResid: r.contactResid,
      contactGroupValue: r.contactGroupValue,
      contactAttrs: (r.contactAttrs ?? {}) as Record<string, string>,
      contactPiiMasks: (r.contactTargetId && piiMasks.get(r.contactTargetId)) || {},
      contactAssignmentName: r.contactAssignmentName,
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

export interface CampaignCandidatesResult {
  rows: CampaignCandidateRow[];
  total: number;
  page: number;
  /** 필터 base 안에서 자동 제외 정책에 걸린 인원 (사유별, 중복 없음) */
  exclusions: CampaignExclusionCounts;
}

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

/**
 * 반송 이력으로 발송에서 자동 제외될 컨택 id 목록 — 마법사 목록 위 예고 숫자용 **칸 단위 근사**
 * (`allCandidatesBouncedSql`). 보낼 열이 하나라도 남은 컨택은 빼지 않는다 — 발송은 다음 순위 열로 넘어간다.
 * 발송 직전 사전 점검(preflightRecipients)과 발송은 칸을 복호화해 정확히 판정한다.
 *
 * sent(미확정) 상태는 배달 시도 중일 뿐이므로 제외 대상이 아니다. 미리보기 목록에서는 제외하지 않는다.
 * 이 함수는 파티션을 가리지 않고 설문 전체를 보는데 순서는 파티션마다 다르다 —
 * 실/테스트 스킴의 순서를 각각 읽어 행의 is_test 로 갈라 쓴다.
 */
export async function listBouncedContactIds(surveyId: string): Promise<string[]> {
  const bounced = await loadBouncedAddresses(surveyId);
  if (bounced.blindIndexes.length === 0) return [];

  const orders = await loadMailEmailOrders(surveyId);
  const excluded = sql`(CASE WHEN ${contactTargets.isTest}
    THEN ${allCandidatesBouncedSql(orders.test, bounced)}
    ELSE ${allCandidatesBouncedSql(orders.real, bounced)}
  END)`;

  const rows = await db
    .select({ id: contactTargets.id })
    .from(contactTargets)
    .where(and(eq(contactTargets.surveyId, surveyId), excluded));

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
 *   - unsubscribed_at IS NULL (수신거부 — 메일 해지)
 *   - 최근 결과코드 수신거부 아님 (status 무관 — neutral 수신거부 코드도 메일 제외)
 *   - 발송 주소로 쓸 email PII 존재 (이메일 누락 제외 — 발송 주소 순서에 든 열 기준)
 *   - 부정 결과코드 마킹 제외
 * + clauses (buildContactsFilterSql) + "미응답자만" 토글.
 *
 * 반송 이력 컨택은 미리보기 명단에는 그대로 표시하고 발송 시점(preflight·
 * createCampaign)에만 제외한다 — 목록에서 조용히 사라지면 명단 대조가 어렵다.
 *
 * clauses 의 PII blindIndex 는 호출자의 조사 대상 필터 해석(resolveContactFilter)에서 이미
 * 계산되어 들어오므로 여기서는 비동기 PII 조회를 하지 않는다 → 동기 함수.
 */
function buildCandidateWhere(
  surveyId: string,
  scope: OperationsDataScope,
  clauses: FilterClause[],
  unrespondedOnly: boolean,
  negativeCodes: string[],
  emailOrder: MailEmailOrder,
): SQL {
  const parts: SQL[] = [
    eq(contactTargets.surveyId, surveyId),
    targetScopeCondition(scope),
    isNull(contactTargets.unsubscribedAt),
    sql`NOT (${latestResultUnsubscribedSql})`,
    hasEmailCandidateSql(emailOrder),
    buildNotExcludedByNegativeCode(negativeCodes),
    buildContactsFilterSql(clauses),
  ];

  if (unrespondedOnly) {
    parts.push(isNull(contactTargets.respondedAt));
  }

  return and(...parts)!;
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
  emailOrder: MailEmailOrder,
): Promise<CampaignExclusionCounts> {
  const hasEmailPii = hasEmailCandidateSql(emailOrder);
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
    bouncedContactIds.length > 0 ? inArray(contactTargets.id, [...bouncedContactIds]) : sql`FALSE`;

  // 수신거부 버킷 = 메일 해지 OR 최근 결과코드 수신거부 (buildCandidateWhere 의 배제 축과 동일).
  const unsubCond = sql`(${contactTargets.unsubscribedAt} IS NOT NULL OR ${latestResultUnsubscribedSql})`;
  const [row] = await db
    .select({
      unsubscribed: sql<number>`count(*) FILTER (WHERE ${unsubCond})::int`,
      negativeCode: sql<number>`count(*) FILTER (WHERE NOT ${unsubCond} AND ${negExists})::int`,
      emailMissing: sql<number>`count(*) FILTER (WHERE NOT ${unsubCond} AND NOT ${negExists} AND NOT ${hasEmailPii})::int`,
      bounced: sql<number>`count(*) FILTER (WHERE NOT ${unsubCond} AND NOT ${negExists} AND ${hasEmailPii} AND ${bouncedCond})::int`,
    })
    .from(contactTargets)
    .where(and(...baseParts)!);

  return row ?? { unsubscribed: 0, negativeCode: 0, emailMissing: 0, bounced: 0 };
}

/**
 * contact_id 목록에 대해 발송 주소 email PII 의 mask_hint 일괄 조회.
 * 한 컨택에 여러 email 컬럼이 있으면 발송 주소 순서가 가장 앞선 것 — 반송된 칸을 건너뛰지 않는다
 * (표시는 순서상 첫 주소, 2026-10-19 결정). 단체 발송은 반송 칸을 건너뛰어 다른 주소로 나갈 수 있다.
 */
async function fetchEmailMaskHints(
  contactIds: readonly string[],
  emailOrder: MailEmailOrder,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (contactIds.length === 0) return result;

  const rows = await selectEmailPiiRows(db, contactIds, emailOrder);
  for (const r of firstEmailRowByTarget(rows).values()) {
    result.set(r.contactTargetId, r.maskHint ?? '');
  }
  return result;
}

const EMAIL_DASH = '—';

/**
 * 메일 표시를 켠 개인정보 열의 마스킹 힌트 — 조사 대상 목록과 같은 값(평문 복호화 없음).
 * 켠 열이 없으면 조회하지 않는다. 결과는 contact_id → (column_key → 힌트), 힌트가 없는 칸은 뺀다.
 */
async function fetchPiiMasks(
  contactIds: readonly string[],
  keys: readonly string[] | undefined,
): Promise<Map<string, Record<string, string>>> {
  const result = new Map<string, Record<string, string>>();
  if (!keys || keys.length === 0 || contactIds.length === 0) return result;
  const wanted = new Set(keys);
  const hints = await getMaskHintsForTargets(contactIds);
  for (const [id, byKey] of hints) {
    const masks: Record<string, string> = {};
    for (const [key, hint] of Object.entries(byKey)) {
      if (wanted.has(key) && hint.maskHint) masks[key] = hint.maskHint;
    }
    result.set(id, masks);
  }
  return result;
}

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
    // 표시(responseStatus)·필터(webStatusCondSql)와 같은 매칭의 활동 시각을 축으로 쓴다.
    // respondedAt 은 완료 시각만 담아 진행중·이탈이 전부 NULL 로 동률이 된다 — 정렬이
    // 성립하지 않고, 세 축이 갈라지면 화면에서 납득 불가능한 순서가 나온다.
    // asc = 활동 없음(미응답) 먼저, desc = 최근 활동 먼저 (기존 방향 의미 보존).
    const activityAt = matchedResponseSubquery(sql`COALESCE(completed_at, last_activity_at)`);
    return dir === 'asc'
      ? sql`${activityAt} ASC NULLS FIRST`
      : sql`${activityAt} DESC NULLS LAST`;
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
  /** 조사 대상 필터 해석 결과 — 해석을 거친 조건만 받는다 */
  filter: ResolvedContactFilter;
  unrespondedOnly: boolean;
  sort?: CampaignSortKey;
  dir?: CampaignSortDir;
  page?: number;
  pageSize?: number;
  /** 메일 표시를 켠 개인정보 열 — 이 열들의 마스킹 힌트만 행에 싣는다. 비면 읽지 않는다. */
  piiMaskKeys?: readonly string[];
  /** 컨택원 이름을 행에 싣는가 — 컨택원 열을 메일 표시로 켠 비게스트 화면만 켠다. */
  includeAssignment?: boolean;
}): Promise<CampaignCandidatesResult> {
  const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;
  const [{ negative: negativeCodes }, bouncedContactIds, emailOrder] = await Promise.all([
    getResultCodeStatuses(args.surveyId),
    listBouncedContactIds(args.surveyId),
    loadMailEmailOrder(args.surveyId, testFlagForScope(args.scope)),
  ]);
  // 반송 컨택은 목록에 포함 — bouncedContactIds 는 exclusions 카운트(발송 시 제외 예고)에만 사용.
  const where = buildCandidateWhere(
    args.surveyId,
    args.scope,
    args.filter.clauses,
    args.unrespondedOnly,
    negativeCodes,
    emailOrder,
  );

  const [[countRow], exclusions] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(contactTargets)
      .where(where),
    countCandidateExclusions(
      args.surveyId,
      args.scope,
      args.filter.clauses,
      args.unrespondedOnly,
      negativeCodes,
      bouncedContactIds,
      emailOrder,
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
      assignmentName: assignmentNameExpr(args.includeAssignment).as('assignment_name'),
      respondedAt: contactTargets.respondedAt,
      // 표시·필터가 같은 매칭(matchedResponseSubquery)을 공유해야 한다 — 갈라지면
      // "진행 중" 으로 거른 행이 표에서는 "미응답" 으로 보인다.
      responseStatus: sql<string | null>`${matchedResponseSubquery(sql`status`)}`.as(
        'response_status',
      ),
      progressPct: sql<number | null>`${matchedResponseSubquery(sql`progress_pct`)}`.as(
        'progress_pct',
      ),
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

  const [maskMap, piiMasks] = await Promise.all([
    fetchEmailMaskHints(rows.map((r) => r.id), emailOrder),
    fetchPiiMasks(rows.map((r) => r.id), args.piiMaskKeys),
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      resid: r.resid,
      email: '', // candidate row 에서는 평문 비공개 — UI 는 emailMasked 만 표시
      emailMasked: maskMap.get(r.id) || EMAIL_DASH,
      groupValue: r.groupValue,
      attrs: (r.attrs ?? {}) as Record<string, string>,
      piiMasks: piiMasks.get(r.id) ?? {},
      assignmentName: r.assignmentName,
      respondedAt: r.respondedAt,
      responseStatus: r.responseStatus,
      progressPct: r.progressPct,
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
  /** 조사 대상 필터 해석 결과 — 해석을 거친 조건만 받는다 */
  filter: ResolvedContactFilter;
  unrespondedOnly: boolean;
}): Promise<number> {
  const [{ negative: negativeCodes }, emailOrder] = await Promise.all([
    getResultCodeStatuses(args.surveyId),
    loadMailEmailOrder(args.surveyId, testFlagForScope(args.scope)),
  ]);
  const where = buildCandidateWhere(
    args.surveyId,
    args.scope,
    args.filter.clauses,
    args.unrespondedOnly,
    negativeCodes,
    emailOrder,
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

// 최신 회차 기록 시각 — 컨택결과 수신거부 행의 해지 시각 표기용.
const latestAttemptAtExpr = sql<Date | null>`(
  SELECT created_at FROM contact_attempts
  WHERE contact_target_id = "contact_targets"."id"
  ORDER BY attempt_no DESC LIMIT 1
)`;

export async function listUnsubscribedContacts(args: {
  surveyId: string;
  scope: OperationsDataScope;
  page?: number;
  pageSize?: number;
  /** 메일 표시를 켠 개인정보 열 — 이 열들의 마스킹 힌트만 행에 싣는다. 비면 읽지 않는다. */
  piiMaskKeys?: readonly string[];
  /** 컨택원 이름을 행에 싣는가 — 컨택원 열을 메일 표시로 켠 비게스트 화면만 켠다. */
  includeAssignment?: boolean;
}): Promise<{ rows: UnsubscribedContactRow[]; total: number; page: number }> {
  const pageSize = args.pageSize ?? DEFAULT_PAGE_SIZE;
  // 수신거부 3축 중 컨택 차원의 두 신호를 union — 메일 해지(unsubscribed_at)와
  // 최근 결과코드 수신거부. 발송 스킵 상태는 이 둘 중 하나에서 파생되므로 별도 축 없음.
  const where = and(
    eq(contactTargets.surveyId, args.surveyId),
    targetScopeCondition(args.scope),
    or(isNotNull(contactTargets.unsubscribedAt), latestResultUnsubscribedSql),
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
      attrs: contactTargets.attrs,
      assignmentName: assignmentNameExpr(args.includeAssignment).as('assignment_name'),
      unsubscribedAt: contactTargets.unsubscribedAt,
      latestResultCode: latestResultCodeExpr.as('latest_result_code'),
      latestAttemptAt: latestAttemptAtExpr.as('latest_attempt_at'),
    })
    .from(contactTargets)
    .where(where)
    .orderBy(
      sql`COALESCE(${contactTargets.unsubscribedAt}, ${latestAttemptAtExpr}) DESC NULLS LAST`,
    )
    .limit(pageSize)
    .offset(offset);

  const emailOrder = await loadMailEmailOrder(args.surveyId, testFlagForScope(args.scope));
  const [maskMap, piiMasks] = await Promise.all([
    fetchEmailMaskHints(
      rows.map((r) => r.id),
      emailOrder,
    ),
    fetchPiiMasks(rows.map((r) => r.id), args.piiMaskKeys),
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      resid: r.resid,
      emailMasked: maskMap.get(r.id) || EMAIL_DASH,
      groupValue: r.groupValue,
      attrs: (r.attrs ?? {}) as Record<string, string>,
      piiMasks: piiMasks.get(r.id) ?? {},
      assignmentName: r.assignmentName,
      unsubscribedAt: r.unsubscribedAt,
      resultUnsubscribedAt: isUnsubscribeResultCode(r.latestResultCode)
        ? r.latestAttemptAt
        : null,
      })),
    total,
    page: clampedPage,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 분기 (마법사 ⑤ preflight) — 사용자 선택 명단과 현재 발송 가능 명단 비교
// ─────────────────────────────────────────────────────────────────────────────

export interface RecipientPreflightResult {
  validIds: string[]; // 발송 가능 (unsubscribed=null, negative code 없음, 보낼 주소 있음)
  unsubscribedIds: string[]; // 사용자 선택 후 unsubscribed 로 전이됨
  excludedByCodeIds: string[]; // negative result_code 마킹으로 제외
  emailMissingIds: string[]; // 쓸 수 있는 이메일 칸 없음 (없음·빈 값·복호화 실패)
  bouncedIds: string[]; // 쓸 수 있는 칸이 전부 반송 주소
  notFoundIds: string[]; // 컨택 삭제됨
}

/**
 * 발송 직전 확인 — 선택 명단을 실제 발송(createCampaign)과 **같은 판정**으로 나눈다.
 * 우선순위: unsubscribed → excludedByCode → 발송 주소 해석(missing → emailMissing, bounced → bounced, send → valid).
 * 발송 주소는 칸을 복호화해 규칙(resolveSendAddresses)으로 판정하므로 숫자가 실제 큐잉 수와 맞는다 —
 * 마법사 목록 예고(listBouncedContactIds, 칸 단위 SQL 근사)와 달리 정확하다.
 */
export async function preflightRecipients(args: {
  surveyId: string;
  scope: OperationsDataScope;
  selectedContactIds: string[];
  /** 이 설문의 반송 주소 — 호출자가 읽어 넘긴다(loadBouncedAddresses) */
  bounced: BouncedAddresses;
}): Promise<RecipientPreflightResult> {
  const empty: RecipientPreflightResult = {
    validIds: [],
    unsubscribedIds: [],
    excludedByCodeIds: [],
    emailMissingIds: [],
    bouncedIds: [],
    notFoundIds: [],
  };
  if (args.selectedContactIds.length === 0) return empty;

  const [{ negative: negativeCodes }, emailOrder] = await Promise.all([
    getResultCodeStatuses(args.surveyId),
    loadMailEmailOrder(args.surveyId, testFlagForScope(args.scope)),
  ]);

  const rows = await db
    .select({
      id: contactTargets.id,
      unsubscribedAt: contactTargets.unsubscribedAt,
      // 최근 결과코드 수신거부 — status(negative) 무관하게 수신거부 버킷으로 분류.
      resultUnsubscribed: sql<boolean>`(${latestResultUnsubscribedSql})`.as('result_unsubscribed'),
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

  const result = { ...empty, validIds: [] as string[] };
  const found = new Set<string>();
  const addressCandidateIds: string[] = [];
  for (const r of rows) {
    found.add(r.id);
    if (r.unsubscribedAt !== null || r.resultUnsubscribed) {
      result.unsubscribedIds.push(r.id);
    } else if (r.excludedByCode) {
      result.excludedByCodeIds.push(r.id);
    } else {
      addressCandidateIds.push(r.id);
    }
  }

  const addresses = await resolveSendAddresses(db, addressCandidateIds, emailOrder, args.bounced);
  for (const id of addressCandidateIds) {
    const kind = addresses.get(id)?.kind ?? 'missing';
    if (kind === 'send') result.validIds.push(id);
    else if (kind === 'bounced') result.bouncedIds.push(id);
    else result.emailMissingIds.push(id);
  }

  result.notFoundIds = args.selectedContactIds.filter((id) => !found.has(id));
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// 미사용 import 경고 회피 (contactAttempts 는 sql template literal 안에서만 참조됨)
// ─────────────────────────────────────────────────────────────────────────────
void contactAttempts;
