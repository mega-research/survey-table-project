import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { contactPii, contactTargets } from '@/db/schema/contacts';
import { decryptPii } from '@/lib/crypto/aes';
import {
  targetScopeCondition,
  type OperationsDataScope,
} from './data-scope.server';

export interface FirstContactSample {
  attrs: Record<string, string>;
  inviteCode: string;
  /** 첫 email PII 의 복호화 평문 — 미리보기 표시용. 없으면 null. */
  email: string | null;
  resid: number;
}

/**
 * 메일 미리보기용 — `resid ASC` 정렬 첫 컨택 1건.
 * 가장 먼저 업로드된 row 로 미리보기를 채운다.
 * 컨택이 0건이면 null.
 *
 * email 은 contact_pii 사이드 테이블에서 복호화 — 한 컨택에 여러 email 컬럼이 있으면
 * column_key 알파벳 순 첫 번째 사용.
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

  const [emailRow] = await db
    .select({ cipher: contactPii.cipher })
    .from(contactPii)
    .where(
      and(
        eq(contactPii.contactTargetId, row.id),
        eq(contactPii.fieldType, 'email'),
      ),
    )
    .orderBy(asc(contactPii.columnKey))
    .limit(1);

  let email: string | null = null;
  if (emailRow) {
    try {
      email = decryptPii(emailRow.cipher);
    } catch {
      // 복호화 실패 시 email null — 미리보기에 이메일 비공개로 표시됨.
    }
  }

  return {
    attrs: row.attrs as Record<string, string>,
    inviteCode: row.inviteCode,
    email,
    resid: row.resid,
  };
}
