import 'server-only';
import { cache } from 'react';

import { and, asc, desc, eq, inArray, isNull, sql, type AnyColumn, type SQL } from 'drizzle-orm';

import { db } from '@/db';
import {
  contactTargets,
  contactUploads,
  surveys,
  questions,
  mailRecipients,
  mailCampaigns,
  responseEditLogs,
} from '@/db/schema';
import type {
  ContactColumnScheme,
  ResponseEditChange,
} from '@/db/schema/schema-types';
import type { MailRecipientStatus } from '@/db/schema/mail';
import { mergeChangeLabels } from '@/lib/operations/response-edit-diff';
import {
  decryptForTarget,
  getMaskHintsForTargets,
} from '@/lib/crypto/contact-pii-repo';
import type { PiiFieldType } from '@/lib/crypto/pii-fields';

import {
  attrsSortKey,
  type ContactsSortDir,
  type ContactsSortKey,
} from './contacts';
import type { FilterClause } from './contacts-filters.server';
import {
  buildContactsFilterSql,
  latestResultCodeExpr,
} from './contacts-filter-sql';
import { FILTER_SOURCE, type ColumnCandidateWithPii } from './filter-shared';
import {
  targetScopeCondition,
  type OperationsDataScope,
} from './data-scope.server';

export interface ListContactsArgs {
  surveyId: string;
  scope: OperationsDataScope;
  clauses: FilterClause[];
  page: number;
  sort: ContactsSortKey;
  dir: ContactsSortDir;
  pageSize: number;
}

export interface ContactsRow {
  id: string;
  resid: number;
  groupValue: string | null;
  /** attrs 통째 (비PII 만 포함됨 — PII 는 piiMaskHints 에) */
  attrs: Record<string, string>;
  /** PII 컬럼별 마스킹 힌트 (columnKey → { fieldType, maskHint }) */
  piiMaskHints: Record<string, { fieldType: PiiFieldType; maskHint: string | null }>;
  /** 최신 attempt result_code (없으면 null) */
  latestResultCode: string | null;
  latestAttemptNo: number | null;
  respondedAt: Date | null;
  /** 응답 진행률 0~100. 응답 없거나 첫 답변 전 / soft-delete 면 null */
  progressPct: number | null;
  /** 최신(created_at DESC) 메일 수신 상태. 발송 이력 없으면 null */
  latestMailStatus: MailRecipientStatus | null;
  inviteToken: string;
  createdAt: Date;
}

export interface ListContactsResult {
  rows: ContactsRow[];
  total: number;
  page: number;
}

// 최신 회차 subquery — latestResultCodeExpr 는 contacts-filter-sql 로 이관(필터·SELECT 공유).
// outer correlation 은 명시적 qualifier 필수 — Drizzle 의 sql template literal 안에서
// ${contactTargets.id} 는 unqualified "id" 로 렌더되어 inner contact_attempts.id 와
// 충돌 (둘 다 id 컬럼 보유) → 항상 NULL. "contact_targets"."id" 직접 박는다.
const latestAttemptNoExpr = sql<number | null>`(
  SELECT attempt_no FROM contact_attempts
  WHERE contact_target_id = "contact_targets"."id"
  ORDER BY attempt_no DESC LIMIT 1
)`;

const progressPctExpr = sql<number | null>`(
  SELECT progress_pct FROM survey_responses
  WHERE id = "contact_targets"."response_id"
    AND deleted_at IS NULL
    AND is_test = "contact_targets"."is_test"
)`;

// 조사 대상별 최신(created_at DESC) 메일 수신 상태 1건.
// outer correlation 은 명시적 qualifier 필수 (latestAttemptNoExpr 주석 참고).
// 인덱스: idx_mail_recipients_target_created (contact_target_id, created_at DESC).
const latestMailStatusExpr = sql<MailRecipientStatus | null>`(
  SELECT mail_recipients.status FROM mail_recipients
  INNER JOIN mail_campaigns ON mail_campaigns.id = mail_recipients.campaign_id
  WHERE mail_recipients.contact_target_id = "contact_targets"."id"
    AND mail_recipients.archived_at IS NULL
    AND mail_campaigns.archived_at IS NULL
    AND mail_campaigns.is_test = "contact_targets"."is_test"
  ORDER BY mail_recipients.created_at DESC LIMIT 1
)`;

function orderExpr(col: AnyColumn | SQL, direction: ContactsSortDir): SQL {
  return direction === 'asc'
    ? sql`${col} ASC NULLS LAST`
    : sql`${col} DESC NULLS LAST`;
}

/**
 * 컨택리스트 메인 어댑터.
 *
 * 핵심:
 * - contact_targets 베이스 + 최신 contact_attempts (correlated subquery) 조인
 * - FilterClause[] 기반 다중 조건 필터 (buildContactsFilterSql)
 * - page 클램프 (profiles.server.ts 패턴)
 * - PII 마스킹 (email/biz)
 *
 * 인덱스: idx_contact_attempts_target (contact_target_id, attempt_no DESC) INCLUDE (result_code)
 *   덕분에 latestResultCode subquery 가 index-only scan 으로 동작.
 */
export async function listContactsForSurvey(
  args: ListContactsArgs,
): Promise<ListContactsResult> {
  const { surveyId, scope, page, pageSize, clauses, sort, dir } = args;

  const whereParts: SQL[] = [
    eq(contactTargets.surveyId, surveyId),
    targetScopeCondition(scope),
  ];

  whereParts.push(buildContactsFilterSql(clauses));

  const whereClause = and(...whereParts)!;

  // 카운트
  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(contactTargets)
    .where(whereClause);
  const total = countRow?.total ?? 0;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const offset = (clampedPage - 1) * pageSize;

  // 정렬 컬럼 — 시스템 키는 fixed 매핑, attrs.<key> 는 JSONB 추출. PII 정렬 불가.
  const SYSTEM_SORT_MAP = {
    resid: contactTargets.resid,
    respondedAt: contactTargets.respondedAt,
    createdAt: contactTargets.createdAt,
    group: contactTargets.groupValue,
  } as const;

  const attrsKey = attrsSortKey(sort);
  const orderCol: AnyColumn | SQL = attrsKey
    ? sql`${contactTargets.attrs} ->> ${attrsKey}`
    : SYSTEM_SORT_MAP[sort as keyof typeof SYSTEM_SORT_MAP] ?? contactTargets.resid;

  const dataRows = await db
    .select({
      id: contactTargets.id,
      resid: contactTargets.resid,
      groupValue: contactTargets.groupValue,
      attrs: contactTargets.attrs,
      respondedAt: contactTargets.respondedAt,
      inviteToken: contactTargets.inviteToken,
      createdAt: contactTargets.createdAt,
      latestResultCode: latestResultCodeExpr.as('latest_result_code'),
      latestAttemptNo: latestAttemptNoExpr.as('latest_attempt_no'),
      progressPct: progressPctExpr.as('progress_pct'),
      latestMailStatus: latestMailStatusExpr.as('latest_mail_status'),
    })
    .from(contactTargets)
    .where(whereClause)
    .orderBy(orderExpr(orderCol, dir), asc(contactTargets.id))
    .limit(pageSize)
    .offset(offset);

  // PII 마스킹 힌트 일괄 조회 (cipher 미포함, 비용 낮음)
  const maskHintsMap = await getMaskHintsForTargets(dataRows.map((r) => r.id));

  const rows: ContactsRow[] = dataRows.map((r) => ({
    id: r.id,
    resid: r.resid,
    groupValue: r.groupValue,
    attrs: (r.attrs ?? {}) as Record<string, string>,
    piiMaskHints: maskHintsMap.get(r.id) ?? {},
    latestResultCode: r.latestResultCode,
    latestAttemptNo: r.latestAttemptNo,
    respondedAt: r.respondedAt,
    progressPct: r.progressPct,
    latestMailStatus: r.latestMailStatus,
    inviteToken: r.inviteToken,
    createdAt: r.createdAt,
  }));

  return { rows, total, page: clampedPage };
}

export interface ContactUploadRow {
  id: string;
  filename: string;
  uploadedRows: number;
  mergedRows: number;
  errorRows: number;
  createdAt: Date;
}

export async function listContactUploads(surveyId: string): Promise<ContactUploadRow[]> {
  const rows = await db
    .select({
      id: contactUploads.id,
      filename: contactUploads.filename,
      uploadedRows: contactUploads.uploadedRows,
      mergedRows: contactUploads.mergedRows,
      errorRows: contactUploads.errorRows,
      createdAt: contactUploads.createdAt,
    })
    .from(contactUploads)
    .where(eq(contactUploads.surveyId, surveyId))
    .orderBy(desc(contactUploads.createdAt));
  return rows;
}

/**
 * surveys.contact_columns 캐시 (RSC pass 내 dedupe).
 * NULL 이면 null 반환 — 호출자가 디폴트 스킴 생성.
 */
export const getContactColumnScheme = cache(
  async (
    surveyId: string,
    scope: OperationsDataScope,
  ): Promise<ContactColumnScheme | null> => {
    const [row] = await db
      .select({
        scheme: scope === 'test' ? surveys.testContactColumns : surveys.contactColumns,
      })
      .from(surveys)
      .where(eq(surveys.id, surveyId))
      .limit(1);
    return (row?.scheme as ContactColumnScheme | null) ?? null;
  },
);

/**
 * 필터 컬럼 후보 생성 — 조사대상목록·단체 메일 마법사 공유.
 * system.resid / system.contact_result / system.web + attrs.* + pii.* 만 후보.
 * placeholder 전용 컬럼(system.email_count / system.contact_owner)은 제외.
 */
export function buildColumnCandidates(
  scheme: ContactColumnScheme | null,
): ColumnCandidateWithPii[] {
  return (scheme?.columns ?? [])
    .filter(
      (c) =>
        c.source === FILTER_SOURCE.RESID ||
        c.source === FILTER_SOURCE.CONTACT_RESULT ||
        c.source === FILTER_SOURCE.WEB ||
        c.source.startsWith(FILTER_SOURCE.ATTRS_PREFIX) ||
        c.source.startsWith(FILTER_SOURCE.PII_PREFIX),
    )
    .map((c) => ({ source: c.source, label: c.label, ...(c.piiType !== undefined ? { piiType: c.piiType } : {}) }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 컨택 단건 편집 (slice 3 detail page) — 0016 마이그레이션 활용
// ─────────────────────────────────────────────────────────────────────────────

import { contactAttempts } from '@/db/schema';
import {
  CONTACT_METHOD_LABEL,
  DEFAULT_RESULT_CODES,
  type ContactMethod,
  type ContactResultCode,
} from '@/db/schema/schema-types';

export interface ContactDetailRow {
  id: string;
  surveyId: string;
  resid: number;
  groupValue: string | null;
  attrs: Record<string, string>;
  /**
   * PII 컬럼 복호화 결과 (columnKey → { fieldType, plain, failed }).
   * 상세 페이지는 RLS owner check 를 통과한 사용자만 접근하므로 평문 노출 OK.
   * failed=true 인 항목은 UI 가 readonly 처리해야 함 (cipher 덮어쓰기 방지).
   */
  piiDecrypted: Record<string, { fieldType: PiiFieldType; plain: string; failed: boolean }>;
  memo: string | null;
  contactMethod: ContactMethod | null;
  inviteToken: string;
  inviteCode: string;
  respondedAt: Date | null;
  responseId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContactAttemptRow {
  id: string;
  attemptNo: number;
  resultCode: string;
  note: string | null;
  createdAt: Date;
}

export interface ContactDetailResult {
  contact: ContactDetailRow;
  attempts: ContactAttemptRow[];
}

/**
 * 컨택 단건 편집 페이지용 — 컨택 본체 + 회차 이력 (최근순).
 * 본인 survey 의 컨택만 조회 (surveyId guard 호출자가 책임).
 */
export async function getContactDetailById(
  id: string,
  scope: OperationsDataScope,
): Promise<ContactDetailResult | null> {
  const [contact] = await db
    .select({
      id: contactTargets.id,
      surveyId: contactTargets.surveyId,
      resid: contactTargets.resid,
      groupValue: contactTargets.groupValue,
      attrs: contactTargets.attrs,
      memo: contactTargets.memo,
      contactMethod: contactTargets.contactMethod,
      inviteToken: contactTargets.inviteToken,
      inviteCode: contactTargets.inviteCode,
      respondedAt: contactTargets.respondedAt,
      responseId: contactTargets.responseId,
      createdAt: contactTargets.createdAt,
      updatedAt: contactTargets.updatedAt,
    })
    .from(contactTargets)
    .where(and(eq(contactTargets.id, id), targetScopeCondition(scope)))
    .limit(1);

  if (!contact) return null;

  const [piiDecrypted, attempts] = await Promise.all([
    decryptForTarget(id),
    db
      .select({
        id: contactAttempts.id,
        attemptNo: contactAttempts.attemptNo,
        resultCode: contactAttempts.resultCode,
        note: contactAttempts.note,
        createdAt: contactAttempts.createdAt,
      })
      .from(contactAttempts)
      .where(eq(contactAttempts.contactTargetId, id))
      .orderBy(desc(contactAttempts.attemptNo)),
  ]);

  return {
    contact: {
      ...contact,
      attrs: (contact.attrs ?? {}) as Record<string, string>,
      piiDecrypted,
      contactMethod: contact.contactMethod as ContactMethod | null,
    },
    attempts,
  };
}

/**
 * 결과코드 조회 — surveys.contact_result_codes 가 NULL 이면 DEFAULT_RESULT_CODES 반환.
 * RSC dedupe 위해 React.cache 적용.
 */
export const getContactResultCodes = cache(
  async (surveyId: string): Promise<ContactResultCode[]> => {
    const [row] = await db
      .select({ codes: surveys.contactResultCodes })
      .from(surveys)
      .where(eq(surveys.id, surveyId))
      .limit(1);
    const codes = (row?.codes as ContactResultCode[] | null) ?? null;
    return codes ?? DEFAULT_RESULT_CODES;
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 단건 편집 — 이메일 발송 현황 / 수정·편집 현황 카드용 조회
// ─────────────────────────────────────────────────────────────────────────────

export interface MailHistoryRow {
  /** mail_recipients.id — React key 용 */
  id: string;
  campaignTitle: string;
  runNumber: number;
  status: MailRecipientStatus;
  sentAt: Date | null;
  deliveredAt: Date | null;
  openedAt: Date | null;
  bouncedAt: Date | null;
  errorReason: string | null;
  createdAt: Date;
}

/** 조사 대상에게 발송된 메일 수신 이력 (최근순). 캠페인 제목/회차 조인. */
export async function getMailRecipientsForTarget(
  contactTargetId: string,
  scope: OperationsDataScope,
): Promise<MailHistoryRow[]> {
  return db
    .select({
      id: mailRecipients.id,
      campaignTitle: mailCampaigns.title,
      runNumber: mailCampaigns.runNumber,
      status: mailRecipients.status,
      sentAt: mailRecipients.sentAt,
      deliveredAt: mailRecipients.deliveredAt,
      openedAt: mailRecipients.openedAt,
      bouncedAt: mailRecipients.bouncedAt,
      errorReason: mailRecipients.errorReason,
      createdAt: mailRecipients.createdAt,
    })
    .from(mailRecipients)
    .innerJoin(mailCampaigns, eq(mailRecipients.campaignId, mailCampaigns.id))
    .innerJoin(contactTargets, eq(mailRecipients.contactTargetId, contactTargets.id))
    .where(
      and(
        eq(mailRecipients.contactTargetId, contactTargetId),
        targetScopeCondition(scope),
        sql`${mailCampaigns.isTest} = ${contactTargets.isTest}`,
        isNull(mailRecipients.archivedAt),
        isNull(mailCampaigns.archivedAt),
      ),
    )
    .orderBy(desc(mailRecipients.createdAt));
}

export interface ResponseEditLogRow {
  id: string;
  editorEmail: string | null;
  changedQuestions: ResponseEditChange[];
  changedCount: number;
  createdAt: Date;
}

/** 응답 편집 audit 이력 (최근순). responseId 없으면 빈 배열. */
export async function getResponseEditLogs(
  responseId: string | null,
): Promise<ResponseEditLogRow[]> {
  if (!responseId) return [];
  const rows = await db
    .select({
      id: responseEditLogs.id,
      surveyId: responseEditLogs.surveyId,
      editorEmail: responseEditLogs.editorEmail,
      changedQuestions: responseEditLogs.changedQuestions,
      changedCount: responseEditLogs.changedCount,
      createdAt: responseEditLogs.createdAt,
    })
    .from(responseEditLogs)
    .where(eq(responseEditLogs.responseId, responseId))
    .orderBy(desc(responseEditLogs.createdAt));
  if (rows.length === 0) return [];

  // 라벨 보강: 기록 시점에 version_id 부재로 questionId 로 폴백된 라벨을
  // 현재 questions 테이블의 code/title 로 복구. 삭제된 질문은 저장값 유지.
  const surveyId = rows[0]!.surveyId;
  const questionIds = [
    ...new Set(rows.flatMap((r) => r.changedQuestions.map((c) => c.questionId))),
  ];
  const labelMap = new Map<string, { code: string | null; title: string }>();
  if (questionIds.length > 0) {
    const qs = await db
      .select({ id: questions.id, code: questions.questionCode, title: questions.title })
      .from(questions)
      .where(and(eq(questions.surveyId, surveyId), inArray(questions.id, questionIds)));
    for (const q of qs) labelMap.set(q.id, { code: q.code, title: q.title });
  }

  return rows.map((r) => ({
    id: r.id,
    editorEmail: r.editorEmail,
    changedQuestions: mergeChangeLabels(r.changedQuestions, labelMap),
    changedCount: r.changedCount,
    createdAt: r.createdAt,
  }));
}

export { CONTACT_METHOD_LABEL };
