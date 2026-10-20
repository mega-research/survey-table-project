import { eq } from 'drizzle-orm';
import 'server-only';

import { type DbOrTx, db } from '@/db';
import { contactPii, contactTargets } from '@/db/schema';
import {
  formatRespondentPiiValue,
  mergeRespondentAttrs,
} from '@/lib/contacts/respondent-pii';
import { decryptPii } from '@/lib/crypto/aes';
import { isPiiFieldType } from '@/lib/crypto/pii-fields';
import { logger } from '@/lib/logger';

/**
 * 응답 화면이 보는 조사 대상의 명단 값 — attrs 에 개인정보로 암호화된 열의 복호화 값을 열 이름 키로
 * 합친 것. 그래서 `{{사업자등록번호}}` 처럼 개인정보 열을 토큰·표시 조건에 그대로 쓸 수 있다.
 * 응답 화면(명단 조회)과 서버 재평가(제출·관리자 수정의 숨은 문항·계산 칸·자격미달, 프리필 강제
 * 복원)가 **같은 값**을 봐야 해서 이 한 곳에서만 만든다 — 서버만 개인정보 값을 못 보면 그 열을 읽는
 * 표시 조건이 서버에서 거짓이 되어 응답자가 본 문항의 답이 제출에서 지워진다.
 *
 * `allowedKeys` 를 주면 그 열만 합친다 — 응답자 브라우저로 가는 조회는 발행본이 실제로 읽는 열만
 * 보낸다(lookupContactAttrs). 서버 안에서 쓰는 재평가는 주지 않는다: 설문이 읽지 않는 키는 평가에
 * 쓰이지 않으므로 전부 합쳐도 결과가 같다. 개인정보 행이 없는 대상은 `allowedKeys` 를 부르지 않는다.
 * 복호화에 실패한 열은 빼고(경고 로그) 나머지로 진행한다 — 값이 비면 프리필 칸은 잠기지 않는다.
 */
export async function appendContactPii(
  target: { id: string; attrs: Record<string, string> | null | undefined },
  options: { allowedKeys?: () => Promise<ReadonlySet<string>> } = {},
  executor: DbOrTx = db,
): Promise<Record<string, string>> {
  const attrs = target.attrs ?? {};
  const rows = await executor
    .select({ fieldType: contactPii.fieldType, columnKey: contactPii.columnKey, cipher: contactPii.cipher })
    .from(contactPii)
    .where(eq(contactPii.contactTargetId, target.id));
  if (rows.length === 0) return attrs;

  const allowed = options.allowedKeys ? await options.allowedKeys() : null;
  const pii: Record<string, string> = {};
  for (const row of rows) {
    if (allowed && !allowed.has(row.columnKey)) continue;
    try {
      const plain = decryptPii(row.cipher);
      pii[row.columnKey] = isPiiFieldType(row.fieldType)
        ? formatRespondentPiiValue(row.fieldType, plain)
        : plain;
    } catch {
      logger.warn(
        { contactTargetId: target.id, columnKey: row.columnKey },
        'respondent contact pii decrypt failed',
      );
    }
  }
  return mergeRespondentAttrs(attrs, pii);
}

/** 조사 대상 id 로 명단 값을 읽는다(서버 재평가·관리자 화면용 — 개인정보 열 전부). 대상이 없으면 빈 객체. */
export async function loadRespondentContactAttrs(
  contactTargetId: string,
  executor: DbOrTx = db,
): Promise<Record<string, string>> {
  const [row] = await executor
    .select({ id: contactTargets.id, attrs: contactTargets.attrs })
    .from(contactTargets)
    .where(eq(contactTargets.id, contactTargetId))
    .limit(1);
  if (!row) return {};
  return appendContactPii(row, {}, executor);
}
