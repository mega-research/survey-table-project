import type { Metadata } from 'next';

import { sql } from 'drizzle-orm';

import { ProgressEmptyCard } from '@/features/operations/report/progress-empty-card';
import { ProgressFilterBar } from '@/features/operations/report/progress-filter-bar';
import {
  ProgressGroupByTabs,
  type GroupByOption,
} from '@/features/operations/report/progress-group-by-tabs';
import { ProgressTable } from '@/features/operations/report/progress-table';
import { db } from '@/db';
import { contactTargets } from '@/db/schema';
import { RESID_DEFAULT_LABEL } from '@/lib/operations/contacts';
import { getContactColumnScheme } from '@/lib/operations/contacts.server';
import type { ProgressSortKey, SortDir } from '@/lib/operations/report-progress';
import {
  getProgressColumnScheme,
  getProgressGroupLabel,
  getProgressRows,
  getProgressTotals,
} from '@/lib/operations/report-progress.server';
import { resolveGroupCriteria } from '@/lib/contacts/group-levels';
import { parseConditionFromUrl } from '@/lib/operations/progress-filters.server';
import { FILTER_SOURCE, type ColumnCandidateWithPii } from '@/lib/operations/filter-shared';
import { getOperationsDataScope, targetScopeCondition } from '@/lib/operations/data-scope.server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '현황 - 그룹별 진척률',
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    col?: string;
    q?: string;
    page?: string;
    size?: string;
    sort?: string;
    dir?: string;
    groupBy?: string;
  }>;
}

const VALID_SORTS: ProgressSortKey[] = [
  'firstResid',
  'groupLabel',
  'listCount',
  'completedCount',
  'responseRate',
];

/**
 * sort 검증 — 고정 5종 + meta:<key> + group:<attrs키> (현재 활성 기준 키만 허용).
 * 알 수 없는 값은 기본 'responseRate' 으로 폴백.
 */
function parseSort(
  s: string | undefined,
  metaKeys: string[],
  groupKeys: string[],
): ProgressSortKey {
  if (!s) return 'responseRate';
  if (VALID_SORTS.includes(s as ProgressSortKey)) return s as ProgressSortKey;
  if (s.startsWith('meta:') && metaKeys.includes(s.slice(5))) return s as ProgressSortKey;
  if (s.startsWith('group:') && groupKeys.includes(s.slice(6))) return s as ProgressSortKey;
  return 'responseRate';
}

/**
 * 운영 콘솔 진척률 페이지.
 *
 * - server component: searchParams (q/page/sort/dir) 를 읽어 server adapter 호출.
 * - 조사 대상 0건이면 무거운 집계 SQL 을 건너뛰고 ProgressEmptyCard 만 렌더.
 * - meta 컬럼은 surveys.progress_columns 스킴(visible+order) 기준 동적 결정.
 */
export default async function ReportProgressPage({ params, searchParams }: PageProps) {
  const { id: surveyId } = await params;
  const sp = await searchParams;
  const scope = await getOperationsDataScope(surveyId);

  // page 파싱 NaN 가드 — `?page=abc` / 음수 / undefined 모두 1 로 fallback.
  // 가드 없으면 SQL OFFSET NaN ERROR 발생.
  const pageRaw = Number(sp.page);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const size = 20;
  const dir: SortDir = sp.dir === 'asc' ? 'asc' : 'desc';

  // contactScheme 은 pii blindIndex 계산용 piiType 매핑에 필요. getContactColumnScheme 가
  // cache() 로 RSC pass dedupe 되어 있어 getProgressGroupLabel 내부 lookup 과 같은 query 를 공유한다.
  const [scheme, groupLabel, contactScheme] = await Promise.all([
    getProgressColumnScheme(surveyId),
    getProgressGroupLabel(surveyId, scope),
    getContactColumnScheme(surveyId, scope),
  ]);
  const visibleColumns = scheme.columns
    .filter((c) => !c.hidden)
    .sort((a, b) => a.order - b.order);
  // metaKeys 에서 빈 문자열 방어 — `attrs->>''` 는 SQL legal 이지만 의미 없음.
  const metaKeys = visibleColumns.map((c) => c.key).filter((k) => k.length > 0);

  // 후보: system.resid + attrs.* + pii.* 만. 그 외 system.* 은 이번 슬라이스 제외.
  const columnCandidates: ColumnCandidateWithPii[] = (contactScheme?.columns ?? [])
    .filter((c) =>
      c.source === FILTER_SOURCE.RESID ||
      c.source.startsWith(FILTER_SOURCE.ATTRS_PREFIX) ||
      c.source.startsWith(FILTER_SOURCE.PII_PREFIX),
    )
    .map((c) => ({
      source: c.source,
      label: c.label,
      ...(c.piiType !== undefined ? { piiType: c.piiType } : {}),
    }));

  const rawCol = typeof sp.col === 'string' ? sp.col : null;
  const rawQ = typeof sp.q === 'string' ? sp.q : null;
  const condition = parseConditionFromUrl(rawCol, rawQ, columnCandidates);

  // 분류 기준 후보 — 컬럼 설정의 레벨 슬롯 배정을 레벨 순서(대>중>소>세부)로.
  // 라벨은 컬럼 설정에서 편집한 헤더 라벨(엑셀 헤더 시드)을 그대로 사용.
  const groupByCriteria: GroupByOption[] = resolveGroupCriteria(contactScheme).map((c) => ({
    key: c.key,
    label: c.label,
  }));
  // URL groupBy 해석:
  // - 미지정 → 컬럼 설정에서 지정한 분류 기준 전체를 설정 순서(대>중>소>세부)대로 자동
  //   선택. 미리 설정해두면 URL 진입만으로 조합 집계가 나오는 모델 (2026-08-14 결정).
  // - 콤마 목록 → 지정된 분류 기준 키만 채택(칩 좁혀보기), 기준 순서로 정규화 + 중복
  //   제거. 유효 키가 하나도 없으면 전체 기준 폴백.
  // - 분류 기준 미지정 설문은 기존처럼 업로드 그룹(group_value) 기준 (칩 없음).
  const rawGroupBy = typeof sp.groupBy === 'string' ? sp.groupBy : null;
  let activeCriteria: GroupByOption[];
  if (rawGroupBy === null) {
    activeCriteria = groupByCriteria;
  } else {
    const requestedKeys = rawGroupBy
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    const matched = groupByCriteria.filter((c) => requestedKeys.includes(c.key));
    activeCriteria = matched.length > 0 ? matched : groupByCriteria;
  }
  const activeKeys = activeCriteria.map((c) => c.key);
  const titleLabel =
    activeCriteria.length > 0 ? activeCriteria.map((c) => c.label).join('·') : groupLabel;
  const parsedSort = parseSort(sp.sort, metaKeys, activeKeys);
  // 시스템ID 컬럼 비표시 시 firstResid 정렬은 보이지 않는 컬럼 정렬이 되므로 기본값 폴백.
  const showResid = scheme.showResid ?? true;
  const sort = !showResid && parsedSort === 'firstResid' ? 'responseRate' : parsedSort;

  // ProgressTable 의 # 컬럼 헤더 — contactColumns 의 system.resid 라벨 사용.
  // 스킴에 없거나 라벨이 비어있으면 기본 라벨 폴백.
  const residLabel =
    contactScheme?.columns.find((c) => c.source === FILTER_SOURCE.RESID)?.label?.trim() ||
    RESID_DEFAULT_LABEL;

  // 조사 대상 0건 빠른 검출 — getProgressTotals 보다 훨씬 가벼움.
  const countRows = await db
    .select({ ct: sql<number>`count(*)::int` })
    .from(contactTargets)
    .where(sql`${contactTargets.surveyId} = ${surveyId} AND ${targetScopeCondition(scope)}`);
  const isEmpty = Number(countRows[0]?.ct ?? 0) === 0;

  const { rows, totals } = isEmpty
    ? { rows: [], totals: { groupCount: 0, listTotal: 0, completedTotal: 0, excludedTotal: 0 } }
    : await Promise.all([
        getProgressRows({
          surveyId,
          scope,
          condition,
          page,
          size,
          sort,
          dir,
          metaKeys,
          groupByKeys: activeKeys,
        }),
        getProgressTotals(surveyId, scope, condition, activeKeys),
      ]).then(([r, t]) => ({ rows: r, totals: t }));

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">{titleLabel}별 진척률</h2>
        {activeCriteria.length === 0 && (
          <p className="text-sm text-slate-500">모집단 명단의 그룹 컬럼 기준 자동 집계</p>
        )}
      </div>

      {isEmpty ? (
        <ProgressEmptyCard surveyId={surveyId} />
      ) : (
        <>
          {groupByCriteria.length > 0 && (
            <ProgressGroupByTabs options={groupByCriteria} activeKeys={activeKeys} />
          )}
          <ProgressFilterBar
            surveyId={surveyId}
            initialSource={condition?.source ?? null}
            // idlist 모드는 FilterCondition 에 value 없음(ranges 만) — rawQ 로 원본 입력값 복원
            initialValue={condition && condition.mode !== 'idlist' ? condition.value : (rawQ ?? '')}
            columnCandidates={columnCandidates}
          />
          <ProgressTable
            rows={rows}
            totals={totals}
            metaColumns={visibleColumns}
            residLabel={residLabel}
            showResid={showResid}
            groupColumns={activeCriteria.map((c) => ({ key: c.key, label: c.label }))}
            page={page}
            size={size}
            sort={sort}
            dir={dir}
          />
        </>
      )}
    </main>
  );
}
