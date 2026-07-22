import type { Metadata } from 'next';

import { sql } from 'drizzle-orm';

import { ProgressEmptyCard } from '@/components/operations/report/progress-empty-card';
import { ProgressFilterBar } from '@/components/operations/report/progress-filter-bar';
import { ProgressTable } from '@/components/operations/report/progress-table';
import { db } from '@/db';
import { contactTargets } from '@/db/schema';
import { getContactColumnScheme } from '@/lib/operations/contacts.server';
import type { ProgressSortKey, SortDir } from '@/lib/operations/report-progress';
import {
  getProgressColumnScheme,
  getProgressGroupLabel,
  getProgressRows,
  getProgressTotals,
} from '@/lib/operations/report-progress.server';
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
 * sort 검증 — 고정 5종 + meta:<key> (단, 현재 visible 메타 컬럼 키만 허용).
 * 알 수 없는 값은 기본 'responseRate' 으로 폴백.
 */
function parseSort(s: string | undefined, metaKeys: string[]): ProgressSortKey {
  if (!s) return 'responseRate';
  if (VALID_SORTS.includes(s as ProgressSortKey)) return s as ProgressSortKey;
  if (s.startsWith('meta:') && metaKeys.includes(s.slice(5))) return s as ProgressSortKey;
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
  const sort = parseSort(sp.sort, metaKeys);

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

  // ProgressTable 의 # 컬럼 헤더 — contactColumns 의 system.resid 라벨 사용.
  // 스킴에 없거나 라벨이 비어있으면 '번호' 폴백.
  const residLabel =
    contactScheme?.columns.find((c) => c.source === FILTER_SOURCE.RESID)?.label?.trim() || '번호';

  // 조사 대상 0건 빠른 검출 — getProgressTotals 보다 훨씬 가벼움.
  const countRows = await db
    .select({ ct: sql<number>`count(*)::int` })
    .from(contactTargets)
    .where(sql`${contactTargets.surveyId} = ${surveyId} AND ${targetScopeCondition(scope)}`);
  const isEmpty = Number(countRows[0]?.ct ?? 0) === 0;

  const { rows, totals } = isEmpty
    ? { rows: [], totals: { groupCount: 0, listTotal: 0, completedTotal: 0, excludedTotal: 0 } }
    : await Promise.all([
        getProgressRows({ surveyId, scope, condition, page, size, sort, dir, metaKeys }),
        getProgressTotals(surveyId, scope, condition),
      ]).then(([r, t]) => ({ rows: r, totals: t }));

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">{groupLabel}별 진척률</h2>
        <p className="text-sm text-slate-500">모집단 명단의 그룹 컬럼 기준 자동 집계</p>
      </div>

      {isEmpty ? (
        <ProgressEmptyCard surveyId={surveyId} />
      ) : (
        <>
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
