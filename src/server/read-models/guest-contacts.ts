import 'server-only';

import { attrsKeyOf, CONTACTS_PAGE_SIZE, piiKeyOf } from '@/lib/operations/contacts-format';
import { mapStatusPill } from '@/lib/operations/profiles-format';
import type { ContactColumnDef } from '@/shared/contracts/contacts';
import type { GuestContactRow, GuestContactsPage } from '@/shared/contracts/workspace-io';

import { GUEST_DATA_SCOPE } from '../data-scope';

import { getContactColumnScheme, listContactsForSurvey } from './contacts';

/**
 * 게스트의 「조사 대상 (마스킹)」 탭 (.pen FLOW 5-2 칩 · 스펙 §5, 티켓 22).
 *
 * **투영을 서버에서 끝내는 것이 이 모듈의 전부다.** 운영 콘솔의 표는 `ContactsRow` 를
 * 그대로 클라이언트로 보내는데, 그 행에는 `inviteToken`(그 사람의 응답 링크)과 컨택 id 가
 * 실려 있다. 게스트에게 그것이 가면 「열람」이 「대리 응답」이 된다 — 그래서 여기서는
 * 표시 문자열만 남기고 나머지를 버린 새 행을 만든다. 화면이 무엇을 안 그리는가가 아니라
 * **무엇이 오지 않는가**가 계약이다.
 *
 * 마스킹의 단위는 컬럼 스킴의 `piiType` 이다. PII 로 매핑된 컬럼은 `contact_pii` 에 암호화돼
 * 있고 목록은 애초에 복호화하지 않는다(마스킹 힌트만 조회) — 원문은 컨택 **상세**에서만
 * 열리고 그 표면은 게스트에게 없다. 반대로 **PII 로 매핑하지 않은 attrs 컬럼은 마스킹
 * 대상이 아니다**: 업로드 시점에 내린 결정이 곧 무엇이 개인정보인가의 정의이고, 그 결정을
 * 이 화면이 뒤늦게 추측하면 컬럼마다 답이 갈린다.
 */

/** 게스트에게 보이지 않는 컬럼 — 메일 축은 스펙 §5 에서 항상 차단이다. */
const HIDDEN_SOURCES = new Set(['system.email_count']);

export async function listGuestContacts(
  surveyId: string,
  page: number,
): Promise<GuestContactsPage> {
  // 파티션 상수의 집은 data-scope 다 — 화면과 read-model 이 같은 값을 본다.
  const scheme = await getContactColumnScheme(surveyId, GUEST_DATA_SCOPE);
  const columnDefs = visibleColumns(scheme?.columns ?? []);

  const result = await listContactsForSurvey({
    surveyId,
    scope: GUEST_DATA_SCOPE,
    page,
    pageSize: CONTACTS_PAGE_SIZE,
    clauses: [],
    sort: 'resid',
    dir: 'asc',
  });

  return {
    columns: columnDefs.map((column) => column.label),
    rows: result.rows.map((row): GuestContactRow => ({
      resid: row.resid,
      cells: columnDefs.map((column) => cellOf(column, row)),
    })),
    total: result.total,
    page: result.page,
    pageSize: CONTACTS_PAGE_SIZE,
  };
}

/** 숨김이 아니고 게스트에게 열린 컬럼만, 스킴이 정한 순서대로. */
function visibleColumns(columns: readonly ContactColumnDef[]): ContactColumnDef[] {
  return columns
    .filter((column) => !column.hidden && !HIDDEN_SOURCES.has(column.source))
    .slice()
    .sort((a, b) => a.order - b.order);
}

type SourceRow = Awaited<ReturnType<typeof listContactsForSurvey>>['rows'][number];

/**
 * 한 칸의 표시 문자열 — 값이 없으면 null 이고 화면이 「—」로 그린다.
 *
 * `system.contact_owner`(면접원)는 운영 콘솔에서도 아직 자리만 있는 컬럼이라 여기서도 빈
 * 칸이다. 지우지 않는 이유는 컬럼 배치가 관리자 화면과 어긋나면 「같은 표인데 열이 다른」
 * 것으로 읽히기 때문이다.
 */
function cellOf(column: ContactColumnDef, row: SourceRow): string | null {
  const attrsKey = attrsKeyOf(column.source);
  if (attrsKey !== null) return row.attrs[attrsKey] ?? null;

  const piiKey = piiKeyOf(column.source);
  // 마스킹 힌트 그대로 — 복호화된 원문은 이 경로에 애초에 실려 오지 않는다.
  if (piiKey !== null) return row.piiMaskHints[piiKey]?.maskHint ?? null;

  switch (column.source) {
    case 'system.resid':
      return String(row.resid);
    case 'system.contact_result':
      return row.latestResultCode;
    case 'system.web':
      return row.responseStatus === null
        ? null
        : mapStatusPill({ status: row.responseStatus }).label;
    default:
      return null;
  }
}
