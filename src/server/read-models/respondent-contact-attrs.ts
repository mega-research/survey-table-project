import { eq, inArray } from 'drizzle-orm';
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
  return mergePiiRows(
    target.id,
    attrs,
    allowed ? rows.filter((row) => allowed.has(row.columnKey)) : rows,
  );
}

interface PiiRow {
  fieldType: string;
  columnKey: string;
  cipher: string;
}

/**
 * 한 대상의 개인정보 행을 명단 값에 합친다 — 단건·일괄이 같은 규칙을 쓰는 유일한 자리.
 * 응답 화면 서식으로 바꾸고(사업자번호 하이픈), 복호화에 실패한 열은 빼고(경고 로그), attrs 가 이긴다.
 */
function mergePiiRows(
  contactTargetId: string,
  attrs: Record<string, string>,
  rows: readonly PiiRow[],
): Record<string, string> {
  if (rows.length === 0) return attrs;
  const pii: Record<string, string> = {};
  for (const row of rows) {
    try {
      const plain = decryptPii(row.cipher);
      pii[row.columnKey] = isPiiFieldType(row.fieldType)
        ? formatRespondentPiiValue(row.fieldType, plain)
        : plain;
    } catch {
      logger.warn(
        { contactTargetId, columnKey: row.columnKey },
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

/** 한 번에 묶어 읽는 대상 수 — `inArray` 바인드 파라미터 한계 안쪽(contacts-export 와 같은 크기). */
const TARGET_CHUNK = 5000;

/**
 * 여러 조사 대상의 명단 값을 한 번에 읽는다 — 단건 `loadRespondentContactAttrs` 와 대상마다 같은 값이다.
 * Raw 내보내기 마지막 그물처럼 행이 많은 서버 재평가용. 없는 대상은 결과에 넣지 않는다.
 */
export async function loadRespondentContactAttrsMany(
  contactTargetIds: readonly string[],
  executor: DbOrTx = db,
): Promise<Map<string, Record<string, string>>> {
  const out = new Map<string, Record<string, string>>();
  const ids = [...new Set(contactTargetIds)];
  for (let i = 0; i < ids.length; i += TARGET_CHUNK) {
    const chunk = ids.slice(i, i + TARGET_CHUNK);
    const [targets, piiRows] = await Promise.all([
      executor
        .select({ id: contactTargets.id, attrs: contactTargets.attrs })
        .from(contactTargets)
        .where(inArray(contactTargets.id, chunk)),
      executor
        .select({
          contactTargetId: contactPii.contactTargetId,
          fieldType: contactPii.fieldType,
          columnKey: contactPii.columnKey,
          cipher: contactPii.cipher,
        })
        .from(contactPii)
        .where(inArray(contactPii.contactTargetId, chunk)),
    ]);
    const rowsByTarget = new Map<string, PiiRow[]>();
    for (const row of piiRows) {
      const list = rowsByTarget.get(row.contactTargetId);
      if (list) list.push(row);
      else rowsByTarget.set(row.contactTargetId, [row]);
    }
    for (const target of targets) {
      out.set(target.id, mergePiiRows(target.id, target.attrs ?? {}, rowsByTarget.get(target.id) ?? []));
    }
  }
  return out;
}
