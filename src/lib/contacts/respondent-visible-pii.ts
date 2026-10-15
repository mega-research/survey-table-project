import type { ContactColumnDef, ContactColumnScheme } from '@/shared/contracts/contacts';
import type { PiiFieldType } from '@/lib/crypto/pii-fields';
import { piiKeyOf } from '@/lib/operations/contacts-format';

/**
 * 응답 화면 노출 — 개인정보로 암호화된 명단 열 중 컬럼 설정에서 「응답 화면에 노출」을 켠 열은
 * 응답 화면의 명단 값(attrs)에 열 이름 키로 합쳐져 프리필 토큰·표시 조건이 읽을 수 있다.
 * 서버(명단 값 로더·컬럼 저장 가드·변수 목록)와 클라이언트(컬럼 설정 스위치)가 공유하는 순수 모듈 —
 * 'server-only' 금지.
 */

/** 응답 화면 노출을 켤 수 있는 열인지 — 개인정보로 암호화된 열만 (attrs 열은 원래 보인다). */
export function canExposeToRespondent(col: Pick<ContactColumnDef, 'source'>): boolean {
  return piiKeyOf(col.source) !== null;
}

/** 컬럼 스킴 → 응답 화면에 노출할 개인정보 열의 contact_pii.column_key 목록. */
export function resolveRespondentVisiblePiiKeys(
  scheme: Pick<ContactColumnScheme, 'columns'> | null | undefined,
): string[] {
  const columns = scheme?.columns;
  if (!Array.isArray(columns)) return [];
  return columns
    .filter((c) => c.respondentVisible === true && canExposeToRespondent(c))
    .map((c) => piiKeyOf(c.source) as string);
}

/** 저장 전 검사 — 문제가 있으면 사용자에게 보일 문구, 없으면 null. */
export function validateRespondentVisible(columns: readonly ContactColumnDef[]): string | null {
  if (columns.some((c) => c.respondentVisible === true && !canExposeToRespondent(c))) {
    return '응답 화면 노출은 개인정보로 암호화된 열에만 지정할 수 있습니다.';
  }
  return null;
}

/**
 * 응답 화면에 낼 값 모양. 사업자번호는 저장 때 숫자만 남겨 두므로(normalizePii) 10자리면
 * `123-45-67890` 으로 되돌린다. 자릿수가 다르거나 다른 종류면 저장된 값 그대로다.
 */
export function formatRespondentPiiValue(fieldType: PiiFieldType, plain: string): string {
  if (fieldType === 'biz_number' && /^\d{10}$/.test(plain)) {
    return `${plain.slice(0, 3)}-${plain.slice(3, 5)}-${plain.slice(5)}`;
  }
  return plain;
}

/**
 * 명단 attrs 에 노출 열 값을 덧붙인다. attrs 에 같은 키가 있으면 attrs 가 이기고, 빈 값은 싣지 않는다
 * (값이 비면 프리필 칸을 잠그지 않는다는 규칙이 키 유무가 아니라 값으로 판정되므로 같은 결과지만,
 * 키를 만들지 않아야 attrs 에 없던 열이 「빈 값으로 있음」으로 보이지 않는다).
 */
export function mergeRespondentAttrs(
  attrs: Record<string, string>,
  exposed: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = { ...attrs };
  for (const [key, value] of Object.entries(exposed)) {
    if (key in merged || value === '') continue;
    merged[key] = value;
  }
  return merged;
}

/**
 * 교체 업로드로 스킴을 다시 만들 때 노출 설정을 옮긴다. 열 이름이 같고 여전히 개인정보 열인 것만
 * 이어받는다 — 옮기지 않으면 재업로드 한 번에 프리필 칸이 조용히 빈칸이 된다.
 */
export function carryOverRespondentVisible(
  next: ContactColumnScheme,
  previous: Pick<ContactColumnScheme, 'columns'> | null | undefined,
): ContactColumnScheme {
  const prevColumns = previous?.columns;
  if (!Array.isArray(prevColumns)) return next;
  const visibleKeys = new Set(
    prevColumns
      .filter((c) => c.respondentVisible === true && canExposeToRespondent(c))
      .map((c) => c.key),
  );
  if (visibleKeys.size === 0) return next;
  return {
    ...next,
    columns: next.columns.map((c) =>
      visibleKeys.has(c.key) && canExposeToRespondent(c) ? { ...c, respondentVisible: true } : c,
    ),
  };
}
