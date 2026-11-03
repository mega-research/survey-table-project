// 대상 정보 수정 현황 — 저장 한 번이 무엇을 바꿨는가를 정하는 순수 규칙 (client-safe).
// 서비스가 대상 행 잠금 아래에서 읽은 지금 값과 실제로 저장할 값을 넘긴다 — 클라이언트가
// 화면을 연 시점 값은 믿지 않는다. 정본 설계는 .scratch/contact-edit-history/PRD.md.
import { attrsKeyOf } from '@/lib/operations/contacts-format';
import {
  CONTACT_TARGET_EDIT_VALUE_MAX,
  type ContactColumnScheme,
  type ContactTargetEditChange,
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
 * - pii 열은 여기서 다루지 않는다(값을 비교하려면 복호화가 필요해 서비스가 따로 판정한다).
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
