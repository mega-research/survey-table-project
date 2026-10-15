import { and, eq, inArray } from 'drizzle-orm';
import 'server-only';

import { type DbOrTx, db } from '@/db';
import { contactPii, contactTargets, surveys } from '@/db/schema';
import {
  formatRespondentPiiValue,
  mergeRespondentAttrs,
  resolveRespondentVisiblePiiKeys,
} from '@/lib/contacts/respondent-visible-pii';
import { decryptPii } from '@/lib/crypto/aes';
import { isPiiFieldType } from '@/lib/crypto/pii-fields';
import { logger } from '@/lib/logger';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';

/** 실·테스트 파티션의 컬럼 스킴 — surveys.contact_columns · test_contact_columns. */
export interface ContactColumnSchemes {
  real: ContactColumnScheme | null | undefined;
  test: ContactColumnScheme | null | undefined;
}

/**
 * 응답 화면이 보는 조사 대상의 명단 값 — attrs 에 「응답 화면에 노출」을 켠 개인정보 열의 복호화 값을
 * 열 이름 키로 합친 것. 응답 화면(명단 조회)과 서버 재평가(제출·관리자 수정의 숨은 문항·계산 칸·
 * 자격미달)가 **같은 값**을 봐야 해서 이 한 곳에서만 만든다 — 서버만 노출 값을 못 보면 그 열을 읽는
 * 표시 조건이 서버에서 거짓이 되어 응답자가 본 문항의 답이 제출에서 지워진다.
 *
 * 노출 열이 없는 설문은 attrs 를 그대로 돌려주고 contact_pii 를 읽지 않는다. 복호화에 실패한 열은
 * 빼고(경고 로그) 나머지로 진행한다 — 값이 비면 프리필 칸은 잠기지 않고 응답자가 직접 적는다.
 */
export async function appendRespondentVisiblePii(
  target: { id: string; isTest: boolean; attrs: Record<string, string> | null | undefined },
  schemes: ContactColumnSchemes,
  executor: DbOrTx = db,
): Promise<Record<string, string>> {
  const attrs = target.attrs ?? {};
  const keys = resolveRespondentVisiblePiiKeys(target.isTest ? schemes.test : schemes.real);
  if (keys.length === 0) return attrs;

  const rows = await executor
    .select({ fieldType: contactPii.fieldType, columnKey: contactPii.columnKey, cipher: contactPii.cipher })
    .from(contactPii)
    .where(and(eq(contactPii.contactTargetId, target.id), inArray(contactPii.columnKey, keys)));

  const exposed: Record<string, string> = {};
  for (const row of rows) {
    try {
      const plain = decryptPii(row.cipher);
      exposed[row.columnKey] = isPiiFieldType(row.fieldType)
        ? formatRespondentPiiValue(row.fieldType, plain)
        : plain;
    } catch {
      logger.warn(
        { contactTargetId: target.id, columnKey: row.columnKey },
        'respondent-visible pii decrypt failed',
      );
    }
  }
  return mergeRespondentAttrs(attrs, exposed);
}

/** 조사 대상 id 로 명단 값을 읽는다 — 대상이 없으면 빈 객체. */
export async function loadRespondentContactAttrs(
  contactTargetId: string,
  executor: DbOrTx = db,
): Promise<Record<string, string>> {
  const [row] = await executor
    .select({
      id: contactTargets.id,
      attrs: contactTargets.attrs,
      isTest: contactTargets.isTest,
      real: surveys.contactColumns,
      test: surveys.testContactColumns,
    })
    .from(contactTargets)
    .innerJoin(surveys, eq(contactTargets.surveyId, surveys.id))
    .where(eq(contactTargets.id, contactTargetId))
    .limit(1);
  if (!row) return {};
  return appendRespondentVisiblePii(row, { real: row.real, test: row.test }, executor);
}
