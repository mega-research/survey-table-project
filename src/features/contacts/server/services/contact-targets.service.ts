import { and, eq, sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { contactTargets, surveyResponses, surveys } from '@/db/schema';
import type { ContactColumnScheme } from '@/db/schema/schema-types';
import { sanitizeAttrsAgainstPiiScheme } from '@/lib/contacts/scheme-helpers';
import { upsertPiiValue } from '@/lib/crypto/contact-pii-repo';
import { generateInviteCode } from '@/lib/survey-url';

import type {
  AddContactTargetInput,
  ContactTargetRow,
  DeleteContactTargetInput,
  UpdateContactTargetInput,
} from '../../domain/contact-target';
import { prepareContactInsertScope } from './contact-insert-scope.service';

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 현재 DB 모드를 기준으로 대상자를 잠근다.
 *
 * 목록을 연 뒤 테스트 모드가 전환된 경우에도 이전 탭이 반대 스코프 행을 수정·삭제하지
 * 못하도록, 설문 행과 대상 행을 같은 트랜잭션에서 순서대로 잠근다.
 */
async function lockTargetInCurrentScope(
  tx: DbTransaction,
  input: { id: string; surveyId: string },
): Promise<{ isTest: boolean; scheme: ContactColumnScheme | null }> {
  const [survey] = await tx
    .select({
      enabled: surveys.testModeEnabled,
      contactColumns: surveys.contactColumns,
      testContactColumns: surveys.testContactColumns,
    })
    .from(surveys)
    .where(eq(surveys.id, input.surveyId))
    .for('update');
  if (!survey) throw new Error('NOT_FOUND');

  const isTest = survey.enabled;
  const [target] = await tx
    .select({ id: contactTargets.id })
    .from(contactTargets)
    .where(
      and(
        eq(contactTargets.id, input.id),
        eq(contactTargets.surveyId, input.surveyId),
        eq(contactTargets.isTest, isTest),
      ),
    )
    .for('update');
  if (!target) throw new Error('NOT_FOUND');

  return {
    isTest,
    scheme: (isTest ? survey.testContactColumns : survey.contactColumns) ?? null,
  };
}

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

  await db.transaction(async (tx) => {
    const { isTest, scheme } = await lockTargetInCurrentScope(tx, { id, surveyId });
    // 모드·대상 소속과 같은 잠금 스냅샷에서 확정한 스킴으로 PII 평문을 제거한다.
    const attrs = sanitizeAttrsAgainstPiiScheme(rawAttrs, scheme);

    // 분류 기준 키가 전달된 경우에만 group_value 재계산.
    // systemFieldKeys.group 이 없으면(예: 자동 감지 실패) 기존 group_value 를 보존해야 함 —
    // 무조건 set 하면 메모/PII 만 수정한 부분 업데이트에서 기존 분류값이 null 로 덮어써짐.
    // 빈 셀('')만 NULL 처리. '0' 등 falsy 문자열 group 라벨은 보존 (|| 사용 금지).
    const hasGroupKey = systemFieldKeys?.group != null;
    const rawGroup = hasGroupKey ? attrs[systemFieldKeys.group as string] : undefined;
    const groupValue = rawGroup != null && rawGroup !== '' ? rawGroup : null;

    // .returning() 길이로 영향 행 수를 판정한다. PII 재암호화(upsertPiiValue)는
    // 현재 모드의 행 소속이 확정된 뒤에만 일어나야 하므로 이 검증을 PII 부수효과보다 앞에 둔다.
    const updated = await tx
      .update(contactTargets)
      .set({
        attrs,
        ...(hasGroupKey ? { groupValue } : {}),
        memo: memo ?? null,
        contactMethod: contactMethod ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(contactTargets.id, id),
          eq(contactTargets.surveyId, surveyId),
          eq(contactTargets.isTest, isTest),
        ),
      )
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
  await db.transaction(async (tx) => {
    const { isTest } = await lockTargetInCurrentScope(tx, { id, surveyId });
    // survey_responses.contact_target_id FK가 아직 적용되지 않은 환경에서도 dangling 참조를
    // 남기지 않는다. target → response 순서는 hard reset과 같고, actual complete는 응답 완료
    // 커밋 뒤 target을 best-effort 갱신하므로 역순 교착 없이 직렬화된다.
    await tx
      .update(surveyResponses)
      .set({ contactTargetId: null })
      .where(and(eq(surveyResponses.surveyId, surveyId), eq(surveyResponses.contactTargetId, id)));
    const deleted = await tx
      .delete(contactTargets)
      .where(
        and(
          eq(contactTargets.id, id),
          eq(contactTargets.surveyId, surveyId),
          eq(contactTargets.isTest, isTest),
        ),
      )
      .returning({ id: contactTargets.id });
    if (deleted.length === 0) throw new Error('NOT_FOUND');
  });
}
