import { and, eq, inArray, or } from 'drizzle-orm';

import { db } from '@/db';
import { contactPii, contactTargets, type NewContactPii } from '@/db/schema';

import { decryptPii, encryptPii } from './aes';
import { blindIndex } from './blind';
import { maskHint } from './mask-hint';
import { type PiiFieldType } from './pii-fields';

export interface PiiInput {
  columnKey: string;
  fieldType: PiiFieldType;
  plain: string;
}

/**
 * PII 입력값들을 contact_pii 행으로 변환. 빈 값/정규화 후 빈 값은 자동으로 스킵.
 * cipher 는 원본값, blind_index 는 정규화 값 기준이라 검색 시 대소문자·구분자 차이 흡수.
 */
export function buildPiiRows(
  contactTargetId: string,
  inputs: readonly PiiInput[],
): NewContactPii[] {
  const rows: NewContactPii[] = [];
  for (const input of inputs) {
    const trimmed = input.plain.trim();
    if (!trimmed) continue;
    const blind = blindIndex(input.fieldType, trimmed);
    if (!blind) continue; // 정규화 후 빈 값 (예: 전화번호에 숫자가 없음)
    rows.push({
      contactTargetId,
      fieldType: input.fieldType,
      columnKey: input.columnKey,
      cipher: encryptPii(trimmed),
      blindIndex: blind,
      maskHint: maskHint(input.fieldType, trimmed),
    });
  }
  return rows;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 트랜잭션 내에서 contact_pii batch insert. UNIQUE (target_id, column_key) 충돌은 무시.
 */
export async function insertPiiRows(tx: Tx, rows: readonly NewContactPii[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(contactPii).values([...rows]).onConflictDoNothing();
}


/**
 * 여러 contact 의 mask_hint 만 일괄 조회. cipher 는 가져오지 않아 비용 낮음.
 * 반환: targetId → columnKey → { fieldType, maskHint }
 */
export async function getMaskHintsForTargets(
  targetIds: readonly string[],
): Promise<Map<string, Record<string, { fieldType: PiiFieldType; maskHint: string | null }>>> {
  const result = new Map<
    string,
    Record<string, { fieldType: PiiFieldType; maskHint: string | null }>
  >();
  if (targetIds.length === 0) return result;

  const rows = await db
    .select({
      contactTargetId: contactPii.contactTargetId,
      fieldType: contactPii.fieldType,
      columnKey: contactPii.columnKey,
      maskHint: contactPii.maskHint,
    })
    .from(contactPii)
    .where(inArray(contactPii.contactTargetId, [...targetIds]));

  for (const r of rows) {
    const existing = result.get(r.contactTargetId) ?? {};
    existing[r.columnKey] = {
      fieldType: r.fieldType as PiiFieldType,
      maskHint: r.maskHint,
    };
    result.set(r.contactTargetId, existing);
  }
  return result;
}

export interface DecryptedPii {
  fieldType: PiiFieldType;
  /** 복호화 성공 시 평문, 실패 시 빈 문자열 (UI 가 failed 플래그를 보고 처리해야 함). */
  plain: string;
  /** 복호화 실패 여부 — true 면 UI 는 readonly 표시 + 저장 시 skip. cipher 덮어쓰기 방지. */
  failed: boolean;
}

/**
 * 단일 contact 의 PII 전체 복호화. 권한 확인 후에만 호출.
 * 반환: columnKey → DecryptedPii. failed=true 인 항목은 UI 가 readonly 처리해서
 * 사용자가 의도치 않게 새 cipher 로 덮어쓰지 않도록 해야 함.
 */
export async function decryptForTarget(
  targetId: string,
): Promise<Record<string, DecryptedPii>> {
  const rows = await db
    .select({
      fieldType: contactPii.fieldType,
      columnKey: contactPii.columnKey,
      cipher: contactPii.cipher,
    })
    .from(contactPii)
    .where(eq(contactPii.contactTargetId, targetId));

  const result: Record<string, DecryptedPii> = {};
  for (const r of rows) {
    let plain = '';
    let failed = false;
    try {
      plain = decryptPii(r.cipher);
    } catch {
      failed = true;
    }
    result[r.columnKey] = {
      fieldType: r.fieldType as PiiFieldType,
      plain,
      failed,
    };
  }
  return result;
}

/**
 * 단건 PII 값 UPSERT (트랜잭션 내).
 * - 빈 값/정규화 후 빈 값 → 기존 행 DELETE
 * - 값 있음 → INSERT or UPDATE (UNIQUE target_id, column_key)
 * cipher/blind_index/mask_hint 모두 새 값으로 재계산.
 */
export async function upsertPiiValue(
  tx: Tx,
  contactTargetId: string,
  columnKey: string,
  fieldType: PiiFieldType,
  plain: string,
): Promise<void> {
  const trimmed = plain.trim();
  if (!trimmed) {
    await tx
      .delete(contactPii)
      .where(
        and(
          eq(contactPii.contactTargetId, contactTargetId),
          eq(contactPii.columnKey, columnKey),
        ),
      );
    return;
  }

  const blind = blindIndex(fieldType, trimmed);
  if (!blind) {
    // 정규화 후 빈 값 (예: 전화번호에 숫자가 없음)
    await tx
      .delete(contactPii)
      .where(
        and(
          eq(contactPii.contactTargetId, contactTargetId),
          eq(contactPii.columnKey, columnKey),
        ),
      );
    return;
  }

  const cipher = encryptPii(trimmed);
  const hint = maskHint(fieldType, trimmed);

  await tx
    .insert(contactPii)
    .values({
      contactTargetId,
      fieldType,
      columnKey,
      cipher,
      blindIndex: blind,
      maskHint: hint,
    })
    .onConflictDoUpdate({
      target: [contactPii.contactTargetId, contactPii.columnKey],
      set: {
        fieldType,
        cipher,
        blindIndex: blind,
        maskHint: hint,
      },
    });
}

/**
 * 단일 (fieldType, plainValue) 정확 매치 검색. surveyId 범위로 한정.
 * 반환: 매칭된 contact_target_id 목록.
 */
export async function findContactIdsByBlindIndex(
  surveyId: string,
  fieldType: PiiFieldType,
  plainValue: string,
): Promise<string[]> {
  const blind = blindIndex(fieldType, plainValue);
  if (!blind) return [];

  const rows = await db
    .select({ targetId: contactPii.contactTargetId })
    .from(contactPii)
    .innerJoin(contactTargets, eq(contactTargets.id, contactPii.contactTargetId))
    .where(
      and(
        eq(contactTargets.surveyId, surveyId),
        eq(contactPii.fieldType, fieldType),
        eq(contactPii.blindIndex, blind),
      ),
    );
  return rows.map((r) => r.targetId);
}

/**
 * 한 plain 값을 여러 fieldType 으로 동시에 검색 — 'all' 통합검색용.
 * 각 fieldType 별 blind_index 미리 계산 → 단일 SQL 로 OR 매치.
 * 6번의 round-trip 을 1번으로 줄이는 최적화.
 */
export async function findContactIdsByPlainAcrossTypes(
  surveyId: string,
  fieldTypes: readonly PiiFieldType[],
  plainValue: string,
): Promise<string[]> {
  if (fieldTypes.length === 0) return [];

  // 각 타입별 blind_index 계산 — 정규화 후 빈 값인 케이스는 제외.
  const pairs: Array<{ fieldType: PiiFieldType; blind: string }> = [];
  for (const t of fieldTypes) {
    const blind = blindIndex(t, plainValue);
    if (blind) pairs.push({ fieldType: t, blind });
  }
  if (pairs.length === 0) return [];

  // OR (field_type=? AND blind_index=?) 들의 합집합. (field_type, blind_index) 인덱스 활용.
  const orClauses = pairs.map((p) =>
    and(eq(contactPii.fieldType, p.fieldType), eq(contactPii.blindIndex, p.blind)),
  );
  const combinedOr = pairs.length === 1 ? orClauses[0] : or(...orClauses);

  const rows = await db
    .select({ targetId: contactPii.contactTargetId })
    .from(contactPii)
    .innerJoin(contactTargets, eq(contactTargets.id, contactPii.contactTargetId))
    .where(and(eq(contactTargets.surveyId, surveyId), combinedOr));
  return Array.from(new Set(rows.map((r) => r.targetId)));
}
