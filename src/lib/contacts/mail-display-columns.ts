import type { ContactColumnDef, ContactColumnScheme } from '@/db/schema/schema-types';
import { attrsKeyOf } from '@/lib/operations/contacts';

/**
 * 메일 발송 표(단체 메일 위저드 미리보기·캠페인 상세 수신자 표)에 얹을 attrs 컬럼.
 * 서버(페이지 로더·가드)와 클라이언트(컬럼 설정 스위치)가 공유하는 순수 모듈 — 'server-only' 금지.
 */

/** 메일 표에 표시할 컬럼 하나 — row.attrs[key] 를 label 헤더 아래 그린다. */
export interface MailDisplayColumn {
  /** attrs 키 */
  key: string;
  /** 컬럼 설정의 표시 라벨 */
  label: string;
}

/** 메일 표시 플래그를 걸 수 있는 컬럼인지 — attrs.* 소스만 (system/pii 는 attrs 에 값이 없다). */
export function canShowInMail(col: Pick<ContactColumnDef, 'source'>): boolean {
  return attrsKeyOf(col.source) !== null;
}

/**
 * 컬럼 스킴 → 메일 표 표시 컬럼 목록 (order 오름차순).
 * showInMail 이 켜진 attrs 컬럼만. 조사 대상 목록의 hidden 은 보지 않는다 —
 * 목록에서 숨긴 컬럼이라도 메일 표에는 따로 올릴 수 있어야 하기 때문.
 */
export function resolveMailDisplayColumns(
  scheme: ContactColumnScheme | null | undefined,
): MailDisplayColumn[] {
  const columns = scheme?.columns;
  if (!Array.isArray(columns)) return [];
  return columns
    .filter((c) => c.showInMail === true && canShowInMail(c))
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ key: attrsKeyOf(c.source) as string, label: c.label }));
}
