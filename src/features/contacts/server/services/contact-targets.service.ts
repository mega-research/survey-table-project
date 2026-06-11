import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets } from '@/db/schema';
import { sanitizeAttrsAgainstPii } from '@/lib/contacts/scheme-helpers';
import { upsertPiiValue } from '@/lib/crypto/contact-pii-repo';

import type {
  AddContactTargetInput,
  ContactTargetRow,
  UpdateContactTargetInput,
} from '../../domain/contact-target';

/**
 * 컨택리스트의 "+ 컨택 추가" 모달 저장.
 * resid 는 next_contact_resid() 로 자동 발번.
 * PII 컬럼은 piiUpdates 로 별도 전달 → contact_pii 에 암호화 저장.
 *
 * 인증은 authed 미들웨어가 담당. 캐시 갱신은 소비처 router.refresh 로 대체.
 */
export async function addContactTarget(
  input: AddContactTargetInput,
): Promise<ContactTargetRow> {
  const { surveyId, attrs: rawAttrs, piiUpdates, memo, contactMethod, systemFieldKeys } = input;

  // UI 우회로 PII 키가 attrs 에 섞여 들어오는 경우 차단 — 평문 누적 방지.
  const attrs = await sanitizeAttrsAgainstPii(surveyId, rawAttrs);

  // 빈 셀('')만 NULL 처리. '0' 등 falsy 문자열 group 라벨은 보존 (|| 사용 금지).
  const rawGroup = systemFieldKeys?.group ? attrs[systemFieldKeys.group] : undefined;
  const groupValue = rawGroup != null && rawGroup !== '' ? rawGroup : null;

  const result = await db.transaction(async (tx) => {
    const residRows = (await tx.execute(
      sql`SELECT next_contact_resid(${surveyId}::uuid) AS resid`,
    )) as unknown as Array<{ resid: number }>;
    const resid = residRows[0]?.resid;
    if (resid == null) throw new Error('next_contact_resid 호출 실패');

    const [row] = await tx
      .insert(contactTargets)
      .values({
        surveyId,
        resid,
        groupValue,
        attrs,
        memo: memo ?? null,
        contactMethod: contactMethod ?? null,
      })
      .returning({ id: contactTargets.id, resid: contactTargets.resid });
    if (!row) throw new Error('contact_targets INSERT 실패');

    if (piiUpdates && piiUpdates.length > 0) {
      for (const p of piiUpdates) {
        await upsertPiiValue(tx, row.id, p.columnKey, p.fieldType, p.plain);
      }
    }

    return row;
  });

  return result;
}

/**
 * 행 단위 갱신 — attrs/group/memo/contactMethod + PII 변경분 upsert.
 */
export async function updateContactTarget(input: UpdateContactTargetInput): Promise<void> {
  const { id, surveyId, attrs: rawAttrs, piiUpdates, memo, contactMethod, systemFieldKeys } = input;

  // UI 우회로 PII 키가 attrs 에 섞여 들어오는 경우 차단 — 평문 누적 방지.
  const attrs = await sanitizeAttrsAgainstPii(surveyId, rawAttrs);

  // 분류 기준 키가 전달된 경우에만 group_value 재계산.
  // systemFieldKeys.group 이 없으면(예: 자동 감지 실패) 기존 group_value 를 보존해야 함 —
  // 무조건 set 하면 메모/PII 만 수정한 부분 업데이트에서 기존 분류값이 null 로 덮어써짐.
  // 빈 셀('')만 NULL 처리. '0' 등 falsy 문자열 group 라벨은 보존 (|| 사용 금지).
  const hasGroupKey = systemFieldKeys?.group != null;
  const rawGroup = hasGroupKey ? attrs[systemFieldKeys.group as string] : undefined;
  const groupValue = rawGroup != null && rawGroup !== '' ? rawGroup : null;

  await db.transaction(async (tx) => {
    await tx
      .update(contactTargets)
      .set({
        attrs,
        ...(hasGroupKey ? { groupValue } : {}),
        memo: memo ?? null,
        contactMethod: contactMethod ?? null,
        updatedAt: new Date(),
      })
      .where(eq(contactTargets.id, id));

    if (piiUpdates && piiUpdates.length > 0) {
      for (const p of piiUpdates) {
        await upsertPiiValue(tx, id, p.columnKey, p.fieldType, p.plain);
      }
    }
  });
}

/**
 * 행 삭제. FK 동작: survey_responses 는 SET NULL(응답 보존), contact_attempts/contact_pii 는 CASCADE.
 */
export async function deleteContactTarget(id: string): Promise<void> {
  await db.delete(contactTargets).where(eq(contactTargets.id, id));
}
