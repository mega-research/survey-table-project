import 'server-only';
import { cache } from 'react';

import { and, asc, desc, eq, ilike, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets, contactUploads, surveys } from '@/db/schema';
import type { ContactColumnScheme } from '@/db/schema/schema-types';

import {
  maskBizNumber,
  maskEmail,
  type ContactsSortDir,
  type ContactsSortKey,
  type NormalizedContactListArgs,
} from './contacts';

export type ListContactsArgs = NormalizedContactListArgs & {
  surveyId: string;
  pageSize: number;
};

export interface ContactsRow {
  id: string;
  resid: number;
  groupValue: string | null;
  emailMasked: string;
  bizMasked: string;
  /** attrs 통째 (마스킹 안 됨 — UI 에서 컬럼별로 마스킹 적용) */
  attrs: Record<string, string>;
  /** 최신 attempt result_code (없으면 null) */
  latestResultCode: string | null;
  latestAttemptNo: number | null;
  respondedAt: Date | null;
  inviteToken: string;
  createdAt: Date;
}

export interface ListContactsResult {
  rows: ContactsRow[];
  total: number;
  page: number;
}

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
 * - 검색 (qfield='all'/'resid'/'email'/'group'/'biz') + resultCode 필터
 * - page 클램프 (profiles.server.ts 패턴)
 * - PII 마스킹 (email/biz)
 *
 * 인덱스: idx_contact_attempts_target (contact_target_id, attempt_no DESC) INCLUDE (result_code)
 *   덕분에 latestResultCode subquery 가 index-only scan 으로 동작.
 */
export async function listContactsForSurvey(
  args: ListContactsArgs,
): Promise<ListContactsResult> {
  const { surveyId, page, pageSize, q, qfield, resultCode, sort, dir } = args;

  const latestAttempt = sql<string | null>`(
    SELECT result_code FROM contact_attempts
    WHERE contact_target_id = ${contactTargets.id}
    ORDER BY attempt_no DESC LIMIT 1
  )`.as('latest_result_code');

  const latestAttemptNoSql = sql<number | null>`(
    SELECT attempt_no FROM contact_attempts
    WHERE contact_target_id = ${contactTargets.id}
    ORDER BY attempt_no DESC LIMIT 1
  )`.as('latest_attempt_no');

  const whereParts: SQL[] = [eq(contactTargets.surveyId, surveyId)];

  const trimmed = q.normalize('NFC').trim();
  if (trimmed.length > 0) {
    if (qfield === 'resid') {
      const n = parseInt(trimmed, 10);
      whereParts.push(Number.isFinite(n) && n > 0 ? eq(contactTargets.resid, n) : sql`false`);
    } else {
      const escaped = trimmed
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
      const pattern = `%${escaped}%`;

      if (qfield === 'email') {
        whereParts.push(ilike(contactTargets.email, pattern));
      } else if (qfield === 'biz') {
        whereParts.push(ilike(contactTargets.bizNumber, pattern));
      } else if (qfield === 'group') {
        whereParts.push(ilike(contactTargets.groupValue, pattern));
      } else {
        // all
        const orClause = or(
          ilike(contactTargets.email, pattern),
          ilike(contactTargets.bizNumber, pattern),
          ilike(contactTargets.groupValue, pattern),
        );
        if (orClause) whereParts.push(orClause);
      }
    }
  }

  if (resultCode !== 'all') {
    whereParts.push(sql`(
      SELECT result_code FROM contact_attempts
      WHERE contact_target_id = ${contactTargets.id}
      ORDER BY attempt_no DESC LIMIT 1
    ) = ${resultCode}`);
  }

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

  // 정렬 컬럼
  const SORT_MAP: Record<ContactsSortKey, AnyColumn | SQL> = {
    resid: contactTargets.resid,
    respondedAt: contactTargets.respondedAt,
    createdAt: contactTargets.createdAt,
    email: contactTargets.email,
    group: contactTargets.groupValue,
  };

  const orderCol = SORT_MAP[sort];

  const dataRows = await db
    .select({
      id: contactTargets.id,
      resid: contactTargets.resid,
      groupValue: contactTargets.groupValue,
      email: contactTargets.email,
      bizNumber: contactTargets.bizNumber,
      attrs: contactTargets.attrs,
      respondedAt: contactTargets.respondedAt,
      inviteToken: contactTargets.inviteToken,
      createdAt: contactTargets.createdAt,
      latestResultCode: latestAttempt,
      latestAttemptNo: latestAttemptNoSql,
    })
    .from(contactTargets)
    .where(whereClause)
    .orderBy(orderExpr(orderCol, dir), asc(contactTargets.id))
    .limit(pageSize)
    .offset(offset);

  const rows: ContactsRow[] = dataRows.map((r) => ({
    id: r.id,
    resid: r.resid,
    groupValue: r.groupValue,
    emailMasked: maskEmail(r.email),
    bizMasked: maskBizNumber(r.bizNumber),
    attrs: (r.attrs ?? {}) as Record<string, string>,
    latestResultCode: r.latestResultCode,
    latestAttemptNo: r.latestAttemptNo,
    respondedAt: r.respondedAt,
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
  async (surveyId: string): Promise<ContactColumnScheme | null> => {
    const [row] = await db
      .select({ contactColumns: surveys.contactColumns })
      .from(surveys)
      .where(eq(surveys.id, surveyId))
      .limit(1);
    return (row?.contactColumns as ContactColumnScheme | null) ?? null;
  },
);
