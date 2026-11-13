import { ORPCError } from '@orpc/server';
import 'server-only';

import { type DbOrTx } from '@/db';
import {
  withoutContactOwnerColumn,
  type NormalizedContactColumnScheme,
} from '@/lib/operations/contacts-format';
import {
  CAMPAIGN_HEADER_FILTER_COLUMNS,
  parseIdListToken,
  type ColumnCandidateWithPii,
  type FilterClause,
} from '@/lib/operations/filter-shared';
import type { OperationsDataScope } from '@/server/data-scope';
import type { ContactResultCode } from '@/shared/contracts/contacts';
import type { ContactAssignmentOption } from '@/shared/contracts/contacts-io';

import { listAssignmentOptions } from './contact-assignment-options';
import { loadIdListsForValues } from './contact-id-lists';
import {
  parseClausesFromUrl,
  parseHeaderFiltersFromUrl,
  type ParseExtraHooks,
} from './contacts-filter-parse';
import {
  buildColumnCandidates,
  getContactColumnScheme,
  getContactResultCodes,
} from './contacts';

/**
 * 조사 대상 필터 해석 (CONTEXT.md 「조사 대상 필터 해석」).
 *
 * 조사 대상 목록 주소 · 단체 메일 스냅샷 · 교체 적용 조건 줄을 이 설문 · 이 파티션 · 이 열람자
 * 기준으로 SQL 이 받을 수 있는 절로 바꾼다. 저장된 ID 목록 읽기 · 컨택원 검증 · 게스트 가리기 ·
 * 검색바와 열 머리 필터 합치기를 이 모듈이 품고, 소비자(목록·후보 조회·교체 적용)는 이 모듈이
 * 만든 결과만 받는다 — 하위 파서로 직접 만든 절은 시그니처가 받지 않는다.
 *
 * 두 단계다. `loadContactFilterContext` 가 재료(스킴·결과코드·컨택원·후보)를 읽고 — 페이지는 같은
 * 컨텍스트를 UI props 에도 쓴다 — `resolveContactFilter` 가 입력에 따라 ID 목록만 더 읽어 해석한다.
 *
 * ── 배선과 규칙 ──
 * - **조사 대상 필터 해석** (2026-10-19): 조사 대상 목록 · 단체 메일 위저드 · `fetchCandidateIds` · 교체
 *   적용(미리보기·오른쪽 목록 포함) · 컨택원 수정 화면이 `server/read-models/contact-filter-resolution.ts` 한
 *   곳으로 조건을 읽는다.
 * - `loadContactFilterContext(surveyId, scope, { isGuest, surface: 'contacts' | 'mail', executor? })` 가
 *   스킴(게스트면 컨택원 열 제거)·결과코드·컨택원 선택지(게스트면 빈 배열)·검색바 후보·열 머리 후보(`mail` 이면
 *   미리보기 고정 열 `CAMPAIGN_HEADER_FILTER_COLUMNS` 를 덧붙임)를 읽고 — 페이지는 같은 컨텍스트를 UI props
 *   에도 쓴다 — `resolveContactFilter(ctx, input, { mode })` 가 ID 목록을 읽어 해석한다.
 * - 입력은 캠페인 스냅샷 모양(`{ clauses: {source,value,op}[]; headerClauses?: {source,mode,hv}[] }`)이고
 *   주소는 `contactFilterInputFromUrl(sp)` 로 바꾼다.
 * - 결과 `ResolvedContactFilter<'read'|'write'>` 는 이 모듈만 만드는 브랜드 타입이고 `{ clauses,
 *   builderClauses, headerClauses, unresolved }` 다.
 * - `listContactsForSurvey`·`previewCampaignCandidates`·`countCampaignCandidates` 는 이 결과(`filter`)만 받고,
 *   교체 적용 같은 **쓰기 서비스는 `ResolvedContactFilter<'write'>` 만 받는다** — write 해석은 해석 안 되는
 *   조건이 하나라도 있으면 `ORPCError BAD_REQUEST`(문구는 모듈 소유: 「조건 N을(를) 지금 적용할 수 없습니다…」
 *   · 「저장된 ID 목록을 찾을 수 없습니다…」).
 * - 하위 파서는 `read-models/contacts-filter-parse.ts` 로 이름을 바꿨고 ESLint 가 해석 모듈 · 응답
 *   내역(`profiles-filters`, 응답 행 위 다른 열을 보는 표면이라 하위 파서 + 훅을 직접 쓴다) · 서버 트리 테스트
 *   밖의 import 를 막는다(`eslint.config.mjs` 의 `CONTACT_FILTER_PARSE_PATTERN`).
 * - `listAssignmentOptions` 는 `read-models/contact-assignment-options.ts` 로 내렸다.
 * - `buildContactsFilterSql` 은 lib 공용이라 `FilterClause[]` 를 그대로 받는다.
 * - 테스트에서 해석이 관심사가 아니면 `tests/helpers/resolved-contact-filter.ts` 의 `resolvedFilterForTest` 를
 *   쓴다.
 *
 * ── 배선과 규칙 ──
 * - **필터 확장** (컨택원 배정과 함께): ① 「현재 컨택원」 `FILTER_SOURCE.CONTACT_OWNER`(`system.contact_owner`)
 *   — 값은 컨택원 id, 배정 없음은 `FILTER_NONE_VALUE`.
 * - 해석 모듈이 이 설문·세션 파티션 컨택원 id 로 검증하고(하위 파서의 `ParseExtraHooks.assignmentIds`, 게스트
 *   컨텍스트는 넘기지 않아 절이 만들어지지 않는다) 다른 설문·파티션 id 는 0건이 아니라 조건 미적용.
 * - 열 후보는 `buildColumnCandidates(scheme, { includeContactOwner: true })` 로 켠 표면만 받는다 — 조사 대상
 *   목록·컨택원 수정·**단체 메일 위저드**(2026-10-19, 「이메일 갱신」처럼 컨택원으로 묶은 명단에 보내기) 셋이고
 *   셋 다 게스트에게는 끈다(위저드의 「필터 결과 전체 선택」 `fetchCandidateIds` 도 procedure 가 넘긴 `isGuest`
 *   로 같다).
 * - **주소·스냅샷의 절이 지금 해석되지 않으면**(지워진 컨택원·빠진 열·읽지 못한 `list:` 토큰) 읽기 해석은 버려
 *   명단이 넓어지므로 결과의 `unresolved` 로 알린다 — 위저드는 경고를 띄우고 「미응답자 재발송」 자동 전체
 *   선택을 하지 않으며, `fetchCandidateIds` 는 write 해석이라 `BAD_REQUEST` 로 거부한다.
 * - 컨택원 열에도 「메일 표시」 스위치가 있다(2026-10-19) — 켜면 위저드 미리보기·캠페인 상세 수신자 표·수신거부
 *   명단에 지금 컨택원 이름이 나오고, 게스트 화면은 켜 두어도 싣지 않는다(`resolveMailDisplayColumns(scheme, {
 *   includeContactOwner: !isGuest })` → 로더 `includeAssignment`).
 * - 열 정렬 키 `owner`(컨택원 순서 → 이름, 배정 없음 끝).
 * - ② `짝수`/`홀수` — 시스템ID·attrs ID 목록 입력이 **그 한 단어일 때만** 키워드(`parseParityKeyword`,
 *   `FilterCondition.parity`).
 * - attrs 는 값 전체가 숫자인 행만(앞자리 0 허용) 나머지 연산, 숫자 아닌 값·빈 값은 어느 쪽에도 안 걸린다 —
 *   상태줄의 「숫자가 아닌 값 N명 제외」는 `contacts.attrValues.nonNumericCount`.
 * - 진척 보고 필터(`progress-filters` 의 `mode:'parity'`)도 같다.
 * - ③ 조건 줄 값 하나에 여러 값 — `encodeMultiClauseValue`(양끝까지 `\u001f` 구분자, trim 이 값 앞뒤 공백을 못
 *   지우게)로 담으면 파서가 헤더 체크박스와 같은 in 절로 읽는다(컨택원 수정 화면 오른쪽 값 목록이 만든다).
 */

export type ContactFilterSurface = 'contacts' | 'mail';
export type ContactFilterMode = 'read' | 'write';

declare const contextBrand: unique symbol;
declare const resolvedBrand: unique symbol;

/** 해석 재료 — `loadContactFilterContext` 만 만든다. 게스트면 컨택원 열·후보·선택지가 빠져 있다. */
export type ContactFilterContext = Readonly<{
  surveyId: string;
  /** 게스트면 컨택원 열을 뺀 스킴 */
  scheme: NormalizedContactColumnScheme | null;
  /** 검색바(조건 줄) 후보 */
  columnCandidates: ColumnCandidateWithPii[];
  /** 열 머리 필터 후보 — 단체 메일은 미리보기 표의 고정 열을 덧붙인다 */
  headerCandidates: ColumnCandidateWithPii[];
  resultCodes: ContactResultCode[];
  /** 이 파티션의 컨택원 — 게스트면 빈 배열 */
  assignmentOptions: ContactAssignmentOption[];
  isGuest: boolean;
}> & { readonly [contextBrand]: true };

/** 입력 — 캠페인 스냅샷과 같은 모양. 주소는 `contactFilterInputFromUrl` 로 바꾼다. */
export interface ContactFilterInput {
  clauses?: ReadonlyArray<{ source: string; value: string; op?: string | null | undefined }> | undefined;
  headerClauses?: ReadonlyArray<{ source: string; mode: string; hv: string }> | undefined;
}

export interface UnresolvedClause {
  part: 'clause' | 'header';
  /** 입력 배열 안 위치(0부터) */
  index: number;
  /** id_list_missing = 읽지 못한 `list:` 토큰(0건 조건으로 남는다), unparseable = 버려진 조건 */
  reason: 'id_list_missing' | 'unparseable';
}

/** 해석 결과 — `resolveContactFilter` 만 만든다. write 결과는 해석 안 되는 조건이 없다. */
export type ResolvedContactFilter<M extends ContactFilterMode = ContactFilterMode> = Readonly<{
  /** 검색바 + 열 머리 필터를 합친 절 — SQL 소비자가 쓴다 */
  clauses: FilterClause[];
  /** 검색바 절만 — 스냅샷·초기 조건 줄 복원용 */
  builderClauses: FilterClause[];
  /** 열 머리 필터 절만 */
  headerClauses: FilterClause[];
  unresolved: UnresolvedClause[];
}> & { readonly [resolvedBrand]: M };

export async function loadContactFilterContext(
  surveyId: string,
  scope: OperationsDataScope,
  opts: { isGuest: boolean; surface: ContactFilterSurface; executor?: DbOrTx },
): Promise<ContactFilterContext> {
  const { isGuest, surface, executor } = opts;
  const [loadedScheme, resultCodes, assignmentOptions] = await Promise.all([
    getContactColumnScheme(surveyId, scope),
    getContactResultCodes(surveyId),
    // 컨택원은 내부 실사 운영 정보 — 게스트에게는 열·후보·선택지·절 모두 싣지 않는다.
    isGuest ? Promise.resolve([]) : listAssignmentOptions(surveyId, scope, executor),
  ]);
  const scheme = isGuest ? withoutContactOwnerColumn(loadedScheme) : loadedScheme;
  const columnCandidates = buildColumnCandidates(scheme, { includeContactOwner: !isGuest });
  // 단체 메일 미리보기 표는 고정 열이라 깔때기 후보도 스킴과 무관하게 고정 목록을 얹는다.
  const headerCandidates =
    surface === 'mail'
      ? [
          ...columnCandidates,
          ...CAMPAIGN_HEADER_FILTER_COLUMNS.filter(
            (c) => !columnCandidates.some((cc) => cc.source === c.source),
          ),
        ]
      : columnCandidates;
  return {
    surveyId,
    scheme,
    columnCandidates,
    headerCandidates,
    resultCodes,
    assignmentOptions,
    isGuest,
  } as ContactFilterContext;
}

export async function resolveContactFilter<M extends ContactFilterMode>(
  ctx: ContactFilterContext,
  input: ContactFilterInput,
  opts: { mode: M },
): Promise<ResolvedContactFilter<M>> {
  const idLists = await loadIdListsForValues(
    ctx.surveyId,
    (input.clauses ?? []).map((c) => c.value),
  );
  return resolveContactFilterWith(ctx, input, idLists, opts.mode);
}

/**
 * 해석 본체 — 재료를 다 받은 동기 함수. read 는 해석 안 되는 조건을 버리고(읽지 못한 ID 목록은
 * 0건 조건으로 남긴다) `unresolved` 에 적는다. write 는 하나라도 있으면 거부한다 — 조건을 버리면
 * 범위가 넓어져(빈 조건이면 전체) 남의 배정을 끌어오거나 화면보다 넓은 명단을 고른다.
 */
export function resolveContactFilterWith<M extends ContactFilterMode>(
  ctx: ContactFilterContext,
  input: ContactFilterInput,
  idLists: ReadonlyMap<string, number[]>,
  mode: M,
): ResolvedContactFilter<M> {
  const hooks: ParseExtraHooks = {
    idLists,
    // 넘기지 않으면 파서가 「현재 컨택원」 절을 만들지 않는다 — 게스트 표면의 기본값.
    ...(ctx.isGuest ? {} : { assignmentIds: new Set(ctx.assignmentOptions.map((o) => o.id)) }),
  };
  const unresolved: UnresolvedClause[] = [];

  const builderClauses: FilterClause[] = [];
  (input.clauses ?? []).forEach((c, index) => {
    // 값이 빈 조건 줄은 원래 쓰지 않는 자리라 버려도 넓어지지 않는다.
    if (c.value.trim().length === 0) return;
    const [parsed] = parseClausesFromUrl(
      [c.source],
      [c.value],
      [c.op ?? ''],
      ctx.columnCandidates,
      ctx.resultCodes,
      hooks,
    );
    if (!parsed) {
      unresolved.push({ part: 'clause', index, reason: 'unparseable' });
      return;
    }
    const token = parseIdListToken(c.value);
    if (token && !idLists.has(token.id)) {
      unresolved.push({ part: 'clause', index, reason: 'id_list_missing' });
    }
    // 한 줄씩 넘기면 하위 파서가 늘 첫 절로 보고 op 를 null 로 덮는다 — op 는 입력에서 읽는다.
    // 출력 첫 절은 항상 op=null — 앞 절이 버려져도 결합 규칙이 깨지지 않게.
    builderClauses.push({
      condition: parsed.condition,
      op: builderClauses.length === 0 ? null : c.op === 'OR' ? 'OR' : 'AND',
    });
  });

  const header = input.headerClauses ?? [];
  header.forEach((h, index) => {
    const parsed = parseHeaderFiltersFromUrl(
      [h.source],
      [h.mode],
      [h.hv],
      ctx.headerCandidates,
      ctx.resultCodes,
      hooks,
    );
    if (parsed.length === 0) unresolved.push({ part: 'header', index, reason: 'unparseable' });
  });
  // 같은 열이 겹치면 마지막이 이기는 규칙은 하위 파서가 소유한다 — 배열째 넘긴다.
  const headerClauses = parseHeaderFiltersFromUrl(
    header.map((h) => h.source),
    header.map((h) => h.mode),
    header.map((h) => h.hv),
    ctx.headerCandidates,
    ctx.resultCodes,
    hooks,
  );

  if (mode === 'write' && unresolved.length > 0) {
    throw new ORPCError('BAD_REQUEST', { message: unresolvedMessage(unresolved[0]!) });
  }

  // UI 가 둘을 상호배타로 다루므로 정상 흐름에선 한쪽만 있다. 주소 조작으로 둘 다 오면 AND 로 무해하게.
  const clauses: FilterClause[] = [
    ...builderClauses,
    ...headerClauses.map((c, i) => ({
      condition: c.condition,
      op: builderClauses.length === 0 && i === 0 ? null : ('AND' as const),
    })),
  ];
  return { clauses, builderClauses, headerClauses, unresolved } as unknown as ResolvedContactFilter<M>;
}

function unresolvedMessage(u: UnresolvedClause): string {
  if (u.reason === 'id_list_missing') {
    return '저장된 ID 목록을 찾을 수 없습니다. 목록을 다시 붙여넣어 주세요.';
  }
  const what = u.part === 'header' ? `열 머리 필터 ${u.index + 1}` : `조건 ${u.index + 1}`;
  return `${what}을(를) 지금 적용할 수 없습니다(지워진 컨택원·없어진 열 등). 조건을 다시 걸어 주세요.`;
}

/** 조사 대상 목록 주소의 필터 파라미터 — 검색바(col/q/op) + 열 머리 필터(hcol/hm/hv). */
export interface ContactListFilterParams {
  col?: string[] | string | undefined;
  q?: string[] | string | undefined;
  op?: string[] | string | undefined;
  hcol?: string[] | string | undefined;
  hm?: string[] | string | undefined;
  hv?: string[] | string | undefined;
}

function toArray(v: string[] | string | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** 주소의 평행 배열 → 입력. 길이가 어긋나면 짧은 쪽에서 자른다(주소 조작 가드 — 종전 파서와 같다). */
export function contactFilterInputFromUrl(params: ContactListFilterParams): ContactFilterInput {
  const col = toArray(params.col);
  const q = toArray(params.q);
  const op = toArray(params.op);
  const hcol = toArray(params.hcol);
  const hm = toArray(params.hm);
  const hv = toArray(params.hv);
  const clauseCount = Math.min(col.length, q.length);
  const headerCount = Math.min(hcol.length, hm.length, hv.length);
  return {
    clauses: Array.from({ length: clauseCount }, (_, i) => ({
      source: col[i]!,
      value: q[i]!,
      op: op[i] ?? '',
    })),
    headerClauses: Array.from({ length: headerCount }, (_, i) => ({
      source: hcol[i]!,
      mode: hm[i]!,
      hv: hv[i]!,
    })),
  };
}
