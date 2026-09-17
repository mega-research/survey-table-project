import 'server-only';

import { db } from '@/db';
import { contactTargets } from '@/db/schema';
import { resolveTestContactFieldBindings } from './test-contact-columns';
import { TEST_CONTACT_FIXTURES } from './test-contact-fixtures';
import { upsertPiiValue } from '@/lib/crypto/contact-pii-repo';
import { generateInviteCode } from '@/lib/survey-url';

import type { GenerateTestContactsInput } from '../domain/contact-target';
import { prepareContactInsertScope } from './contact-insert-scope';
import { allocateContactResid } from './contact-resid';

/**
 * isGuest 는 procedure 가 이미 인증한 context.user.id 에서 파생해 전달한다 — 서비스가
 * auth 를 재조회하면 그 실패가 fail-open(어드민 취급)으로 이어질 수 있다.
 */
export async function generateTestContacts(
  input: GenerateTestContactsInput,
  isGuest: boolean,
): Promise<{ createdCount: number }> {
  return db.transaction(async (tx) => {
    const prepared = await prepareContactInsertScope(tx, {
      surveyId: input.surveyId,
      requestedCount: input.count,
      requireEmptyTestScope: true,
      isGuest,
    });
    if (!prepared.scheme) throw new Error('테스트 대상자 컬럼을 찾을 수 없습니다.');

    const bindings = resolveTestContactFieldBindings(prepared.scheme);
    for (const fixture of TEST_CONTACT_FIXTURES.slice(0, input.count)) {
      const resid = await allocateContactResid(tx, input.surveyId, prepared.isTest);

      const [target] = await tx
        .insert(contactTargets)
        .values({
          surveyId: input.surveyId,
          resid,
          isTest: prepared.isTest,
          groupValue: fixture.region,
          attrs: {
            [bindings.company.columnKey]: fixture.company,
            [bindings.region.columnKey]: fixture.region,
          },
          inviteCode: generateInviteCode(),
        })
        .returning({ id: contactTargets.id });
      if (!target) throw new Error('테스트 대상자 저장에 실패했습니다.');

      await upsertPiiValue(
        tx,
        target.id,
        bindings.name.columnKey,
        bindings.name.fieldType,
        fixture.name,
      );
      await upsertPiiValue(
        tx,
        target.id,
        bindings.phone.columnKey,
        bindings.phone.fieldType,
        fixture.phone,
      );
      await upsertPiiValue(
        tx,
        target.id,
        bindings.email.columnKey,
        bindings.email.fieldType,
        input.recipientEmail,
      );
    }

    return { createdCount: input.count };
  });
}
