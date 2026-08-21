import { and, asc, eq, inArray } from 'drizzle-orm';

import { type DbOrTx, type DbTransaction as Tx, db } from '@/db';
import { type NewContactPii, contactPii } from '@/db/schema';

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

/**
 * 트랜잭션 내에서 contact_pii batch insert. UNIQUE (target_id, column_key) 충돌은 무시.
 */
export async function insertPiiRows(tx: Tx, rows: readonly NewContactPii[]): Promise<void> {
  if (rows.length === 0) return;
  await tx
    .insert(contactPii)
    .values([...rows])
    .onConflictDoNothing();
}

export interface EmailPiiRow {
  id: string;
  contactTargetId: string;
  columnKey: string;
  cipher: string;
  maskHint: string | null;
}

/**
 * 컨택들의 email PII 행을 (contact_target_id, column_key) 오름차순으로 조회한다.
 * "컨택의 이메일 = field_type='email' 이고 column_key 오름차순 첫 컬럼" 불변식의 단일 소스.
 *
 * DISTINCT ON 으로 첫 행만 자르지 않고 전 행을 돌려준다 — 발송 경로(createCampaign·preflight)는
 * 첫 컬럼이 복호화 실패/공백이면 다음 컬럼으로 폴백하므로 "첫 usable 컬럼" 선택은 호출부가 맡는다.
 * 순수하게 첫 컬럼만 필요한 호출부는 firstEmailRowByTarget 으로 줄인다.
 * 트랜잭션 안팎 모두에서 쓰도록 executor 를 주입받는다.
 */
export async function selectEmailPiiRows(
  executor: DbOrTx,
  contactTargetIds: readonly string[],
): Promise<EmailPiiRow[]> {
  if (contactTargetIds.length === 0) return [];
  return executor
    .select({
      id: contactPii.id,
      contactTargetId: contactPii.contactTargetId,
      columnKey: contactPii.columnKey,
      cipher: contactPii.cipher,
      maskHint: contactPii.maskHint,
    })
    .from(contactPii)
    .where(
      and(
        eq(contactPii.fieldType, 'email'),
        inArray(contactPii.contactTargetId, [...contactTargetIds]),
      ),
    )
    .orderBy(asc(contactPii.contactTargetId), asc(contactPii.columnKey));
}

/** selectEmailPiiRows 결과(정렬 보장)에서 컨택당 첫 행만 남긴다 — column_key 오름차순 첫 컬럼. */
export function firstEmailRowByTarget<T extends { contactTargetId: string }>(
  rows: readonly T[],
): Map<string, T> {
  const first = new Map<string, T>();
  for (const row of rows) {
    if (!first.has(row.contactTargetId)) first.set(row.contactTargetId, row);
  }
  return first;
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

/**
 * 여러 contact 의 지정 columnKey PII 만 일괄 복호화 — 응답 내역 목록 표시용.
 * 페이지 단위 targetIds 로만 호출할 것 (복호화 비용). 복호화 실패 항목은 결과에서 제외
 * (목록은 '—' 폴백 — 상세 페이지의 failed readonly 처리와 달리 편집 경로가 아니므로 안전).
 * 반환: targetId → columnKey → 평문
 */
export async function decryptPiiForTargets(
  targetIds: readonly string[],
  columnKeys: readonly string[],
): Promise<Map<string, Record<string, string>>> {
  const result = new Map<string, Record<string, string>>();
  if (targetIds.length === 0 || columnKeys.length === 0) return result;

  const rows = await db
    .select({
      contactTargetId: contactPii.contactTargetId,
      columnKey: contactPii.columnKey,
      cipher: contactPii.cipher,
    })
    .from(contactPii)
    .where(
      and(
        inArray(contactPii.contactTargetId, [...targetIds]),
        inArray(contactPii.columnKey, [...columnKeys]),
      ),
    );

  for (const r of rows) {
    let plain: string;
    try {
      plain = decryptPii(r.cipher);
    } catch {
      continue;
    }
    const existing = result.get(r.contactTargetId) ?? {};
    existing[r.columnKey] = plain;
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
export async function decryptForTarget(targetId: string): Promise<Record<string, DecryptedPii>> {
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
        and(eq(contactPii.contactTargetId, contactTargetId), eq(contactPii.columnKey, columnKey)),
      );
    return;
  }

  const blind = blindIndex(fieldType, trimmed);
  if (!blind) {
    // 정규화 후 빈 값 (예: 전화번호에 숫자가 없음)
    await tx
      .delete(contactPii)
      .where(
        and(eq(contactPii.contactTargetId, contactTargetId), eq(contactPii.columnKey, columnKey)),
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
