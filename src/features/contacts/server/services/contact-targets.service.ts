import { and, eq, sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { contactTargets } from '@/db/schema';
import {
  sanitizeAttrsAgainstPii,
  sanitizeAttrsAgainstPiiScheme,
} from '@/lib/contacts/scheme-helpers';
import { upsertPiiValue } from '@/lib/crypto/contact-pii-repo';
import { generateInviteCode } from '@/lib/survey-url';

import type {
  AddContactTargetInput,
  ContactTargetRow,
  DeleteContactTargetInput,
  UpdateContactTargetInput,
} from '../../domain/contact-target';
import { prepareContactInsertScope } from './contact-insert-scope.service';

/**
 * 컨택리스트의 "+ 컨택 추가" 모달 저장.
 * resid 는 next_contact_resid() 로 자동 발번.
 * PII 컬럼은 piiUpdates 로 별도 전달 → contact_pii 에 암호화 저장.
 *
 * 인증은 authed 미들웨어가 담당. 캐시 갱신은 소비처 router.refresh 로 대체.
 */
export async function addContactTarget(input: AddContactTargetInput): Promise<ContactTargetRow> {
  const { surveyId, attrs: rawAttrs, piiUpdates, memo, contactMethod, systemFieldKeys } = input;

  const result = await db.transaction(async (tx) => {
    const prepared = await prepareContactInsertScope(tx, {
      surveyId,
      requestedCount: 1,
      requireEmptyTestScope: false,
    });
    // 잠금 뒤 읽은 현재 스코프의 스킴으로 평문 PII 누적을 차단한다.
    const attrs = sanitizeAttrsAgainstPiiScheme(rawAttrs, prepared.scheme);
    // 빈 셀('')만 NULL 처리. '0' 등 falsy 문자열 group 라벨은 보존 (|| 사용 금지).
    const rawGroup = systemFieldKeys?.group ? attrs[systemFieldKeys.group] : undefined;
    const groupValue = rawGroup != null && rawGroup !== '' ? rawGroup : null;

    const residRows = (await tx.execute(
      sql`SELECT next_contact_resid(${surveyId}::uuid, ${prepared.isTest}) AS resid`,
    )) as unknown as Array<{ resid: number }>;
    const resid = residRows[0]?.resid;
    if (resid == null) throw new Error('next_contact_resid 호출 실패');

    const [row] = await tx
      .insert(contactTargets)
      .values({
        surveyId,
        resid,
        isTest: prepared.isTest,
        groupValue,
        attrs,
        memo: memo ?? null,
        contactMethod: contactMethod ?? null,
        inviteCode: generateInviteCode(),
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
    // 설문 스코프 가드: 행이 input.surveyId 소속일 때만 UPDATE.
    // .returning() 길이로 영향 행 수를 판정한다. PII 재암호화(upsertPiiValue)는
    // 행 소속이 확정된 뒤에만 일어나야 하므로 이 검증을 PII 부수효과보다 앞에 둔다.
    const updated = await tx
      .update(contactTargets)
      .set({
        attrs,
        ...(hasGroupKey ? { groupValue } : {}),
        memo: memo ?? null,
        contactMethod: contactMethod ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(contactTargets.id, id), eq(contactTargets.surveyId, surveyId)))
      .returning({ id: contactTargets.id });
    if (updated.length === 0) throw new Error('NOT_FOUND');

    if (piiUpdates && piiUpdates.length > 0) {
      for (const p of piiUpdates) {
        await upsertPiiValue(tx, id, p.columnKey, p.fieldType, p.plain);
      }
    }
  });
}

/**
 * 행 삭제. FK 동작: survey_responses 는 SET NULL(응답 보존), contact_attempts/contact_pii 는 CASCADE.
 *
 * 설문 스코프 가드: 행이 input.surveyId 소속일 때만 DELETE. CASCADE(attempts/pii 동반 삭제)는
 * 비가역적이므로 .returning() 길이로 영향 0행이면 NOT_FOUND throw 하여 사전 차단한다.
 */
export async function deleteContactTarget(input: DeleteContactTargetInput): Promise<void> {
  const { id, surveyId } = input;
  const deleted = await db
    .delete(contactTargets)
    .where(and(eq(contactTargets.id, id), eq(contactTargets.surveyId, surveyId)))
    .returning({ id: contactTargets.id });
  if (deleted.length === 0) throw new Error('NOT_FOUND');
}
