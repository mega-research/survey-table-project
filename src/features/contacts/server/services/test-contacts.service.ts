import { sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { contactTargets } from '@/db/schema';
import { resolveTestContactFieldBindings } from '@/lib/contacts/test-contact-columns';
import { TEST_CONTACT_FIXTURES } from '@/lib/contacts/test-contact-fixtures';
import { upsertPiiValue } from '@/lib/crypto/contact-pii-repo';
import { generateInviteCode } from '@/lib/survey-url';

import type { GenerateTestContactsInput } from '../../domain/contact-target';
import { prepareContactInsertScope } from './contact-insert-scope.service';

export async function generateTestContacts(
  input: GenerateTestContactsInput,
): Promise<{ createdCount: number }> {
  return db.transaction(async (tx) => {
    const prepared = await prepareContactInsertScope(tx, {
      surveyId: input.surveyId,
      requestedCount: input.count,
      requireEmptyTestScope: true,
    });
    if (!prepared.scheme) throw new Error('테스트 대상자 컬럼을 찾을 수 없습니다.');

    const bindings = resolveTestContactFieldBindings(prepared.scheme);
    for (const fixture of TEST_CONTACT_FIXTURES.slice(0, input.count)) {
      const residRows = (await tx.execute(
        sql`SELECT next_contact_resid(${input.surveyId}::uuid, ${prepared.isTest}) AS resid`,
      )) as unknown as Array<{ resid: number }>;
      const resid = residRows[0]?.resid;
      if (resid == null) throw new Error('next_contact_resid 호출 실패');

      const [target] = await tx
        .insert(contactTargets)
        .values({
          surveyId: input.surveyId,
          resid: Number(resid),
          isTest: prepared.isTest,
          attrs: { [bindings.company.columnKey]: fixture.company },
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
