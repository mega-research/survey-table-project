import type { ContactColumnDef, ContactColumnScheme } from '@/shared/contracts/contacts';
import { attrsKeyOf, piiKeyOf } from '@/lib/operations/contacts-format';

/**
 * 메일 발송 표(단체 메일 위저드 미리보기·캠페인 상세 수신자 표·수신거부 명단)에 얹을 컬럼.
 * 서버(페이지 로더·가드)와 클라이언트(컬럼 설정 스위치)가 공유하는 순수 모듈 — 'server-only' 금지.
 *
 * - 명단 속성(attrs.*) 열: 켜면 attrs 값을 그린다.
 * - 개인정보(pii.*) 열: 켜면 조사 대상 목록과 같은 마스킹 힌트를 그린다(평문 복호화 없음).
 * - 컨택원(system.contact_owner): 켜면 대상이 지금 맡겨진 컨택원 이름을 그린다. 내부 실사 정보라 게스트
 *   화면에는 켜 두어도 나오지 않는다 — 페이지가 `includeContactOwner` 를 게스트에게 끈다.
 * - 시스템ID(system.resid): 표의 맨 앞 고정 열이다. 기본으로 보이고, 끄면 `showInMail: false` 로 숨긴다 —
 *   다른 열과 기본값이 반대인 것은 이 스위치가 생기기 전부터 늘 보이던 열이라서다.
 */

/**
 * 메일 표에 표시할 컬럼 하나 — kind 에 따라 attrs[key] · 개인정보 마스킹 힌트[key] · 컨택원 이름을 그린다.
 */
export interface MailDisplayColumn {
  /** attrs 키 또는 개인정보 column_key (컨택원은 'contact_owner') */
  key: string;
  /** 컬럼 설정의 표시 라벨 */
  label: string;
  kind: 'attrs' | 'pii' | 'owner';
}

const CONTACT_OWNER_SOURCE = 'system.contact_owner';

function isResidColumn(col: Pick<ContactColumnDef, 'source'>): boolean {
  return col.source === 'system.resid';
}

function isContactOwnerColumn(col: Pick<ContactColumnDef, 'source'>): boolean {
  return col.source === CONTACT_OWNER_SOURCE;
}

/**
 * 메일 표시 스위치를 걸 수 있는 컬럼인지 — attrs.*·pii.*·시스템ID·컨택원.
 * 그 밖의 운영 컬럼(system.*)은 메일 표에 따로 있다.
 */
export function canShowInMail(col: Pick<ContactColumnDef, 'source'>): boolean {
  return (
    attrsKeyOf(col.source) !== null ||
    piiKeyOf(col.source) !== null ||
    isResidColumn(col) ||
    isContactOwnerColumn(col)
  );
}

/** 이 컬럼이 메일 표에 보이는가 — 시스템ID 는 끄지 않았으면 보이고, 나머지는 켰을 때만 보인다. */
export function isShownInMail(col: Pick<ContactColumnDef, 'source' | 'showInMail'>): boolean {
  if (!canShowInMail(col)) return false;
  return isResidColumn(col) ? col.showInMail !== false : col.showInMail === true;
}

/**
 * 메일 표시 스위치를 뒤집은 컬럼. 기본값으로 돌아가면 필드를 지워 스킴 JSON 을 깨끗하게 유지한다.
 * 시스템ID 의 기본은 보임이라 끄면 `false` 가 남고, 나머지의 기본은 숨김이라 켜면 `true` 가 남는다.
 */
export function toggleShowInMail(col: ContactColumnDef): ContactColumnDef {
  const { showInMail: _drop, ...rest } = col;
  const next = !isShownInMail(col);
  const isDefault = isResidColumn(col) ? next : !next;
  return isDefault ? rest : { ...rest, showInMail: next };
}

/**
 * 컬럼 스킴 → 메일 표 표시 컬럼 목록 (order 오름차순). 시스템ID 는 맨 앞 고정 열이라 여기 넣지 않는다
 * (`resolveMailShowsResid`). 조사 대상 목록의 hidden 은 보지 않는다 —
 * 목록에서 숨긴 컬럼이라도 메일 표에는 따로 올릴 수 있어야 하기 때문.
 * 컨택원 열은 `includeContactOwner` 를 켠 호출(게스트가 아닌 화면)에만 나온다.
 */
export function resolveMailDisplayColumns(
  scheme: ContactColumnScheme | null | undefined,
  options: { includeContactOwner?: boolean } = {},
): MailDisplayColumn[] {
  const columns = scheme?.columns;
  if (!Array.isArray(columns)) return [];
  return columns
    .filter((c) => !isResidColumn(c) && isShownInMail(c))
    .filter((c) => options.includeContactOwner === true || !isContactOwnerColumn(c))
    .sort((a, b) => a.order - b.order)
    .map((c) => {
      if (isContactOwnerColumn(c)) {
        return { key: 'contact_owner', label: c.label, kind: 'owner' as const };
      }
      const piiKey = piiKeyOf(c.source);
      return piiKey !== null
        ? { key: piiKey, label: c.label, kind: 'pii' as const }
        : { key: attrsKeyOf(c.source) as string, label: c.label, kind: 'attrs' as const };
    });
}

/** 메일 표 맨 앞의 시스템ID 열을 그리는가 — 스킴에 열이 없거나 끄지 않았으면 그린다. */
export function resolveMailShowsResid(scheme: ContactColumnScheme | null | undefined): boolean {
  const columns = scheme?.columns;
  if (!Array.isArray(columns)) return true;
  const resid = columns.find(isResidColumn);
  return resid ? isShownInMail(resid) : true;
}

/** 서버가 행마다 컨택원 이름을 읽어 와야 하는가. */
export function mailShowsContactOwner(columns: readonly MailDisplayColumn[]): boolean {
  return columns.some((c) => c.kind === 'owner');
}

/** 서버가 마스킹 힌트를 읽어 와야 하는 개인정보 column_key 목록. */
export function mailPiiMaskKeys(columns: readonly MailDisplayColumn[]): string[] {
  return columns.filter((c) => c.kind === 'pii').map((c) => c.key);
}

/** 메일 표 칸 하나의 값 — 비면 빈 문자열(표가 대시로 그린다). 컨택원은 배정 없음이면 빈 값이다. */
export function mailColumnValue(
  col: MailDisplayColumn,
  attrs: Record<string, string>,
  piiMasks: Record<string, string>,
  assignmentName?: string | null,
): string {
  if (col.kind === 'owner') return assignmentName ?? '';
  return (col.kind === 'pii' ? piiMasks[col.key] : attrs[col.key]) ?? '';
}
