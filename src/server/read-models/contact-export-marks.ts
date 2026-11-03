import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { contactAttempts, contactTargetEditLogs } from '@/db/schema';
import type { ContactTargetEditChange } from '@/shared/contracts/contacts';

/** 한 번에 inArray 로 넘길 조사 대상 수 — 내보내기 상한(1만)을 몇 번에 나눠 읽는다. */
const CHUNK = 2000;

function chunks<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

/**
 * 조사 대상별 마지막 회차 결과코드 — 회차 번호가 가장 큰 기록 하나(운영 콘솔 「컨택결과」 열과 같은
 * 기준, `latestResultCodeExpr`). 회차가 없는 대상은 맵에 없다.
 */
export async function loadLatestResultCodes(
  targetIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const ids of chunks([...new Set(targetIds)])) {
    const rows = await db
      .selectDistinctOn([contactAttempts.contactTargetId], {
        contactTargetId: contactAttempts.contactTargetId,
        resultCode: contactAttempts.resultCode,
      })
      .from(contactAttempts)
      .where(inArray(contactAttempts.contactTargetId, ids))
      .orderBy(contactAttempts.contactTargetId, desc(contactAttempts.attemptNo));
    for (const r of rows) out.set(r.contactTargetId, r.resultCode);
  }
  return out;
}

/** 고친 칸 판정의 재료 — 한 대상의 기록을 오래된 순으로 */
export interface EditedSourceInput {
  /** 지금 attrs — 일반 열은 고쳤다가 처음 값으로 되돌렸으면 칠하지 않는다 */
  attrs: Readonly<Record<string, string>>;
  changes: readonly ContactTargetEditChange[];
}

/**
 * 손으로 고친 명단 열 — source('attrs.<key>' / 'pii.<column_key>') 집합. pure.
 *
 * 일반 열은 **처음 고치기 전 값과 지금 값이 다를 때만** 고친 칸이다 — 고쳤다가 원래대로 돌려놓은
 * 칸은 원본과 같으므로 칠하지 않는다. 개인정보 열은 기록에 값이 없어(0152) 그렇게 가릴 수 없으니
 * 한 번이라도 입력·변경·삭제가 있으면 고친 칸이다.
 */
export function resolveEditedSources(input: EditedSourceInput): Set<string> {
  const firstBefore = new Map<string, string>();
  const pii = new Set<string>();
  for (const change of input.changes) {
    if (change.kind === 'attr') {
      if (!firstBefore.has(change.key)) firstBefore.set(change.key, change.before);
    } else if (change.kind === 'pii') {
      pii.add(change.key);
    }
  }
  const out = new Set<string>();
  for (const [key, before] of firstBefore) {
    if ((input.attrs[key] ?? '') !== before) out.add(`attrs.${key}`);
  }
  for (const key of pii) out.add(`pii.${key}`);
  return out;
}

/**
 * 조사 대상별 손으로 고친 명단 열 — 「대상 정보 수정 현황」의 정보 수정 기록에서. 고친 열이 없는
 * 대상은 맵에 없다. 일괄 쓰기(명단 업로드·교체)는 기록되지 않으므로(0152 범위) 칠해지지 않는다.
 */
export async function loadEditedSources(
  targets: readonly { id: string; attrs: Readonly<Record<string, string>> }[],
): Promise<Map<string, Set<string>>> {
  const attrsById = new Map(targets.map((t) => [t.id, t.attrs]));
  const changesById = new Map<string, ContactTargetEditChange[]>();
  for (const ids of chunks([...attrsById.keys()])) {
    const rows = await db
      .select({
        contactTargetId: contactTargetEditLogs.contactTargetId,
        changes: contactTargetEditLogs.changes,
      })
      .from(contactTargetEditLogs)
      .where(
        and(
          inArray(contactTargetEditLogs.contactTargetId, ids),
          eq(contactTargetEditLogs.action, 'info_edit'),
        ),
      )
      .orderBy(asc(contactTargetEditLogs.createdAt), asc(contactTargetEditLogs.id));
    for (const r of rows) {
      const list = changesById.get(r.contactTargetId) ?? [];
      list.push(...(r.changes ?? []));
      changesById.set(r.contactTargetId, list);
    }
  }
  const out = new Map<string, Set<string>>();
  for (const [id, changes] of changesById) {
    const sources = resolveEditedSources({ attrs: attrsById.get(id) ?? {}, changes });
    if (sources.size > 0) out.set(id, sources);
  }
  return out;
}
