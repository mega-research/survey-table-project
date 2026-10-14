import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets } from '@/db/schema/contacts';
import {
  targetScopeCondition,
  testFlagForScope,
  type OperationsDataScope,
} from '@/server/data-scope';

import { loadSendEmailForTarget } from './mail-email-order';

export interface FirstContactSample {
  attrs: Record<string, string>;
  inviteCode: string;
  /** 발송 주소(email PII 복호화 평문) — 미리보기 표시용. 없으면 null. */
  email: string | null;
  resid: number;
}

interface ContactSampleRow {
  id: string;
  attrs: unknown;
  inviteCode: string;
  resid: number;
}

/**
 * email 복호화 블록 — `getFirstContactSample` / `getContactSampleById` 공유.
 * 한 컨택에 여러 email 컬럼이 있으면 발송과 같은 규칙으로 고른다(`loadSendEmailForTarget`) —
 * 미리보기에 보이는 주소가 실제로 나가는 주소여야 한다.
 */
async function withDecryptedEmail(
  row: ContactSampleRow,
  surveyId: string,
  scope: OperationsDataScope,
): Promise<FirstContactSample> {
  const email = await loadSendEmailForTarget({
    id: row.id,
    surveyId,
    isTest: testFlagForScope(scope),
  });

  return {
    attrs: row.attrs as Record<string, string>,
    inviteCode: row.inviteCode,
    email,
    resid: row.resid,
  };
}

/**
 * 메일 미리보기용 — `resid ASC` 정렬 첫 컨택 1건.
 * 가장 먼저 업로드된 row 로 미리보기를 채운다.
 * 컨택이 0건이면 null.
 *
 * email 은 contact_pii 사이드 테이블에서 복호화 — 한 컨택에 여러 email 컬럼이 있으면
 * 발송 주소 순서를 따른다.
 */
export async function getFirstContactSample(
  surveyId: string,
  scope: OperationsDataScope,
): Promise<FirstContactSample | null> {
  const [row] = await db
    .select({
      id: contactTargets.id,
      attrs: contactTargets.attrs,
      inviteCode: contactTargets.inviteCode,
      resid: contactTargets.resid,
    })
    .from(contactTargets)
    .where(and(eq(contactTargets.surveyId, surveyId), targetScopeCondition(scope)))
    .orderBy(asc(contactTargets.resid))
    .limit(1);
  if (!row) return null;

  return withDecryptedEmail(row, surveyId, scope);
}

/**
 * 특정 컨택 1건 샘플 — 단건 발송 미리보기용. 스코프 불일치/미존재면 null.
 */
export async function getContactSampleById(
  surveyId: string,
  contactTargetId: string,
  scope: OperationsDataScope,
): Promise<FirstContactSample | null> {
  const [row] = await db
    .select({
      id: contactTargets.id,
      attrs: contactTargets.attrs,
      inviteCode: contactTargets.inviteCode,
      resid: contactTargets.resid,
    })
    .from(contactTargets)
    .where(
      and(
        eq(contactTargets.id, contactTargetId),
        eq(contactTargets.surveyId, surveyId),
        targetScopeCondition(scope),
      ),
    )
    .limit(1);
  if (!row) return null;
  return withDecryptedEmail(row, surveyId, scope);
}
