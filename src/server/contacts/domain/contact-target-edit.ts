// 대상 정보 수정 현황 — 저장 한 번이 무엇을 바꿨는가를 정하는 순수 규칙 (client-safe).
// 서비스가 대상 행 잠금 아래에서 읽은 지금 값과 실제로 저장할 값을 넘긴다 — 클라이언트가
// 화면을 연 시점 값은 믿지 않는다. 정본 설계는 .scratch/contact-edit-history/PRD.md.
import { attrsKeyOf, piiKeyOf } from '@/lib/operations/contacts-format';
import {
  CONTACT_TARGET_EDIT_VALUE_MAX,
  type ContactColumnScheme,
  type ContactTargetEditChange,
  type ContactTargetEditPiiOp,
} from '@/shared/contracts/contacts';

/** 기록을 남기는 편집자 — procedure 가 인증된 context 에서 넘긴다(서비스가 auth 를 다시 읽지 않는다). */
export interface ContactEditor {
  id: string | null;
  email: string | null;
}

/** 대상 정보 저장이 비교하는 값 묶음. attrs 는 PII 정제 뒤의 값이어야 한다. */
export interface ContactTargetInfoValues {
  attrs: Record<string, string>;
  memo: string | null;
  contactMethod: string | null;
}

/** 값 하나를 기록 크기로 자른다. 코드 포인트 단위라 이모지 한가운데를 자르지 않는다. */
function clip(value: string): { text: string; truncated: boolean } {
  const chars = Array.from(value);
  if (chars.length <= CONTACT_TARGET_EDIT_VALUE_MAX) return { text: value, truncated: false };
  return { text: chars.slice(0, CONTACT_TARGET_EDIT_VALUE_MAX).join(''), truncated: true };
}

/** before·after 를 잘라 담고, 잘린 쪽에만 표식을 단다. */
function clippedPair(
  before: string,
  after: string,
): { before: string; after: string; beforeTruncated?: true; afterTruncated?: true } {
  const b = clip(before);
  const a = clip(after);
  return {
    before: b.text,
    after: a.text,
    ...(b.truncated ? { beforeTruncated: true as const } : {}),
    ...(a.truncated ? { afterTruncated: true as const } : {}),
  };
}

/** null·undefined·빈 문자열을 같은 빈 값('')으로 접는다. */
function norm(value: string | null | undefined): string {
  return value ?? '';
}

/** attrs 키 → 저장 시점 열 이름. 스킴에 없으면 키 그대로. */
function attrLabelMap(scheme: ContactColumnScheme | null): Map<string, string> {
  const map = new Map<string, string>();
  for (const col of scheme?.columns ?? []) {
    const key = attrsKeyOf(col.source);
    if (key != null && !map.has(key)) map.set(key, col.label || key);
  }
  return map;
}

/**
 * 대상 정보(attrs·메모·컨택 방법) 저장의 변경 목록.
 *
 * - attrs 는 키 합집합을 본다 — 키가 생기거나 없어진 것도 변경이다(빈 값 ↔ 빈 값은 아니다).
 *   순서는 스킴 열 순서, 스킴에 없는 키는 그 뒤에 지금 값 → 새 값 순으로.
 * - 바뀐 것이 없으면 빈 배열 — 서비스는 이때 기록을 남기지 않는다.
 * - pii 열은 여기서 다루지 않는다 — 값을 비교하려면 복호화가 필요해 서비스가 지금 값을 읽어
 *   `diffContactTargetPii` 로 따로 판정한다.
 */
export function diffContactTargetInfo(
  before: ContactTargetInfoValues,
  after: ContactTargetInfoValues,
  scheme: ContactColumnScheme | null,
): ContactTargetEditChange[] {
  const labels = attrLabelMap(scheme);
  const keys = new Set<string>();
  for (const key of labels.keys()) {
    if (key in before.attrs || key in after.attrs) keys.add(key);
  }
  for (const key of Object.keys(before.attrs)) keys.add(key);
  for (const key of Object.keys(after.attrs)) keys.add(key);

  const changes: ContactTargetEditChange[] = [];
  for (const key of keys) {
    const b = norm(before.attrs[key]);
    const a = norm(after.attrs[key]);
    if (b === a) continue;
    changes.push({ kind: 'attr', key, label: labels.get(key) ?? key, ...clippedPair(b, a) });
  }

  const memoBefore = norm(before.memo);
  const memoAfter = norm(after.memo);
  if (memoBefore !== memoAfter) {
    changes.push({ kind: 'memo', ...clippedPair(memoBefore, memoAfter) });
  }

  const methodBefore = norm(before.contactMethod);
  const methodAfter = norm(after.contactMethod);
  if (methodBefore !== methodAfter) {
    changes.push({ kind: 'contactMethod', before: methodBefore, after: methodAfter });
  }

  return changes;
}

/**
 * 개인정보 열 하나의 지금 저장값 — 서비스가 잠금 아래에서 복호화해 메모리에서만 넘긴다.
 * 행이 없는 열은 맵에 없다. 복호화에 실패하면 `failed`.
 */
export type StoredPiiPlain = { plain: string } | { failed: true };

/** 저장 한 번이 개인정보 열 하나에 남기는 값 — `null` 은 그 열의 행을 지운다는 뜻이다. */
export interface PiiWrite {
  columnKey: string;
  next: string | null;
}

/** pii 열 키 → 저장 시점 열 이름. 스킴에 없으면 키 그대로. */
function piiLabelMap(scheme: ContactColumnScheme | null): Map<string, string> {
  const map = new Map<string, string>();
  for (const col of scheme?.columns ?? []) {
    const key = piiKeyOf(col.source);
    if (key != null && !map.has(key)) map.set(key, col.label || key);
  }
  return map;
}

/**
 * 개인정보 열 저장의 변경 목록 — 값은 담지 않고 열 이름과 op 만 낸다(이력이 개인정보 사본이 되지 않게).
 *
 * - 지금 행 없음 + 새 값 = `set`, 둘 다 있고 다름 = `changed`, 지금 행 있음 + 새 값 없음 = `cleared`.
 *   같은 값이거나 없는 행을 비우는 것은 변경이 아니다.
 * - 지금 값을 복호화할 수 없는 열은 확인할 수 없지만 덮어쓴 것은 사실이라 `changed`(비우면 `cleared`).
 * - 같은 열이 두 번 오면 마지막 값이 저장되므로 마지막 값으로 판정한다. 순서는 처음 나온 순서.
 */
export function diffContactTargetPii(
  stored: ReadonlyMap<string, StoredPiiPlain>,
  writes: readonly PiiWrite[],
  scheme: ContactColumnScheme | null,
): ContactTargetEditChange[] {
  const finalNext = new Map<string, string | null>();
  for (const w of writes) finalNext.set(w.columnKey, w.next);

  const labels = piiLabelMap(scheme);
  const changes: ContactTargetEditChange[] = [];
  for (const [key, next] of finalNext) {
    const current = stored.get(key);
    let op: ContactTargetEditPiiOp | null;
    if (current === undefined) op = next === null ? null : 'set';
    else if (next === null) op = 'cleared';
    else if ('failed' in current) op = 'changed';
    else op = current.plain === next ? null : 'changed';
    if (op) changes.push({ kind: 'pii', key, label: labels.get(key) ?? key, op });
  }
  return changes;
}
