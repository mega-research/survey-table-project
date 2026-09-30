import 'server-only';

import {
  attrsKeyOf,
  CONTACTS_PAGE_SIZE,
  effectiveSortKey,
  normalizeSortKey,
} from '@/lib/operations/contacts-format';
import { FILTER_SOURCE, type FilterClause } from '@/lib/operations/filter-shared';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';
import type { ContactsListPageData } from '@/shared/contracts/contacts-io';

import type { OperationsDataScope } from '../data-scope';
import { loadIdListsForValues } from './contact-id-lists';
import {
  buildColumnCandidates,
  getContactColumnScheme,
  getContactResultCodes,
  listContactsForSurvey,
} from './contacts';
import { parseClausesFromUrl, parseHeaderFiltersFromUrl } from './contacts-filters';

/**
 * 조사 대상 목록 화면의 조립 (ADR-0026, 티켓 06).
 *
 * 내부 콘솔 트리(`app/(internal)`)와 외주 실사 링크 트리(`/fw`)가 **같은 화면**을 그리므로 그 재료를 만드는
 * 자리도 하나여야 한다. 예전에는 이 60줄이 admin 페이지 본문에 인라인으로 있었고, 링크
 * 트리가 그것을 복제하면 필터 파싱 규칙이 두 벌이 되어 한쪽만 고쳐진다 — 「스킴에서 숨긴
 * 컬럼으로 정렬하면 resid 로 접는다」 같은 규칙이 정확히 그런 종류다.
 *
 * 여러 도메인 테이블을 **읽기만** 하므로 read-model 이 집이다. 파티션(`scope`)은 인자로
 * 받는다 — 주체마다 다르고(링크는 언제나 real) 그 판정은 `data-scope` 의 일이다.
 */
export interface ContactsListPageArgs {
  surveyId: string;
  scope: OperationsDataScope;
  /**
   * 메일 축을 볼 수 있는가 — `mail.view` (ADR-0026, 티켓 06).
   *
   * 「수신 상황」 열은 초대 메일의 전달·열람·반송 상태라 **연구원의 채널**이다. 외주 실사
   * 링크에는 메일 capability 가 하나도 없고, 그 사실이 목록에도 그대로 서야 한다.
   *
   * 화면이 아니라 여기서 걸러 내는 것이 요점이다 — 열을 숨기는 것만으로는 URL 의
   * `hcol=system.email_count` 헤더 필터와 `sort=mailStatus` 정렬이 그대로 살아, 보이지 않는
   * 축으로 목록을 줄 세우거나 좁힐 수 있다. 세 자리(열·후보·정렬)를 한 곳에서 닫는다.
   *
   * **닫지 않는 것도 적어 둔다.** 행 모양(`ContactsRow`)은 그대로라 `latestMailStatus` 와
   * `inviteToken` 이 RSC payload 에는 실린다. 스펙이 「새 투영을 만들지 않는다」로 못 박은
   * 자리이고(게스트는 반대로 값을 지운 투영을 쓴다), 링크는 대리 응답 자격을 갖는 주체라
   * 초대 토큰이 곧 권한 상승이 아니다 — 그 노출 판정은 단건 상세(티켓 08)가 진다.
   */
  canViewMail: boolean;
  /** 라우트가 읽은 URL 쿼리 그대로. 키 이름은 주소 계약이라 두 트리가 같다. */
  searchParams: {
    col?: string | string[];
    q?: string | string[];
    op?: string | string[];
    hcol?: string | string[];
    hm?: string | string[];
    hv?: string | string[];
    page?: string;
    sort?: string;
    dir?: string;
  };
}

export async function loadContactsListPage({
  surveyId,
  scope,
  canViewMail,
  searchParams: sp,
}: ContactsListPageArgs): Promise<ContactsListPageData> {
  const pageRaw = Number(sp.page);
  const parsedPage = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const dir = sp.dir === 'desc' ? ('desc' as const) : ('asc' as const);

  const [rawScheme, resultCodes] = await Promise.all([
    getContactColumnScheme(surveyId, scope),
    getContactResultCodes(surveyId),
  ]);
  const scheme = canViewMail ? rawScheme : stripMailColumns(rawScheme);

  // sort key — hidden 컬럼이면 'resid' 폴백 (URL 직접 조작 가드)
  const visibleAttrsKeys = new Set(
    (scheme?.columns ?? [])
      .filter((c) => !c.hidden)
      .map((c) => attrsKeyOf(c.source))
      .filter((k): k is string => k != null),
  );
  const requestedSort = effectiveSortKey(normalizeSortKey(sp.sort), visibleAttrsKeys);
  const sort = !canViewMail && requestedSort === 'mailStatus' ? 'resid' : requestedSort;

  // 후보는 걸러진 스킴에서 나온다 — 헤더 필터·조건 파싱이 전부 이 목록을 화이트리스트로 쓴다.
  const columnCandidates = buildColumnCandidates(scheme);

  // 붙여넣기 대용량 목록은 URL 에 `list:<uuid>` 토큰으로만 실린다 — 파싱 전에 실체를 읽는다.
  const idLists = await loadIdListsForValues(surveyId, sp.q);
  const builderClauses = parseClausesFromUrl(sp.col, sp.q, sp.op, columnCandidates, resultCodes, {
    idLists,
  });
  const headerClauses = parseHeaderFiltersFromUrl(
    sp.hcol,
    sp.hm,
    sp.hv,
    columnCandidates,
    resultCodes,
  );
  // UI 가 상호배타를 강제하므로 정상 흐름에선 한쪽만 존재.
  // URL 직접 조작으로 둘 다 있으면 AND 결합으로 무해하게 처리.
  const clauses: FilterClause[] = [
    ...builderClauses,
    ...headerClauses.map((c, i) => ({
      condition: c.condition,
      op: builderClauses.length === 0 && i === 0 ? null : ('AND' as const),
    })),
  ];

  const { rows, total, page } = await listContactsForSurvey({
    surveyId,
    scope,
    pageSize: CONTACTS_PAGE_SIZE,
    clauses,
    page: parsedPage,
    sort,
    dir,
  });

  return {
    scheme,
    resultCodes,
    columnCandidates,
    initialClauses: builderClauses.map((c) => ({
      op: c.op,
      source: c.condition.source,
      value: c.condition.value,
    })),
    rows,
    total,
    page,
    pageSize: CONTACTS_PAGE_SIZE,
    sort,
    dir,
    hasFilter: clauses.length > 0,
    isTestScope: scope === 'test',
  };
}

/**
 * 메일 축 열을 뺀 스킴 — 없으면 그대로 없다.
 *
 * 스킴은 JSONB 문서라 얕은 사본으로 충분하다(컬럼 배열만 갈아 끼운다). 원본을 건드리면
 * `getContactColumnScheme` 의 React cache 가 같은 요청 안의 다른 소비자에게 깎인 스킴을
 * 돌려준다 — 컬럼 설정 화면과 목록이 같은 캐시를 본다.
 */
function stripMailColumns(scheme: ContactColumnScheme | null): ContactColumnScheme | null {
  if (!scheme) return scheme;
  const columns = scheme.columns.filter((column) => column.source !== FILTER_SOURCE.EMAIL);
  return columns.length === scheme.columns.length ? scheme : { ...scheme, columns };
}
