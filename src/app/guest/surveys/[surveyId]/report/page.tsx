import { GuestEmptyState } from '@/features/guest-console/guest-empty-state';
import {
  type GroupByOption,
  ProgressGroupByTabs,
} from '@/features/operations/report/progress-group-by-tabs';
import { ProgressTable } from '@/features/operations/report/progress-table';
import { resolveGroupCriteria } from '@/lib/contacts/group-levels';
import { RESID_DEFAULT_LABEL } from '@/lib/operations/contacts-format';
import { FILTER_SOURCE } from '@/lib/operations/filter-shared';
import type { SortDir } from '@/lib/operations/report-progress-format';
import {
  EMPTY_PROGRESS_TOTALS,
  parseProgressSort,
  resolveActiveGroupKeys,
} from '@/lib/operations/report-progress-format';
import { assertGuestSurveyPageAccess } from '@/server/page-guest-access';
import { getContactColumnScheme } from '@/server/read-models/contacts';
import {
  countContactTargets,
  getProgressColumnScheme,
  getProgressGroupLabel,
  getProgressRows,
  getProgressTotals,
} from '@/server/operations/services/report-progress';

import { GUEST_DATA_SCOPE } from '@/server/data-scope';

interface Props {
  params: Promise<{ surveyId: string }>;
  searchParams: Promise<{ page?: string; groupBy?: string; sort?: string; dir?: string }>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '진척 보고' };

const PAGE_SIZE = 20;

/**
 * 진척 보고 — 그룹별 진척률 (.pen FLOW 5-2 칩 「진척 보고」, 스펙 §5).
 *
 * 운영 콘솔의 같은 표를 같은 서비스 위에 얹되 **필터 바만 뺀다**.
 *
 * 필터 바는 컨택 컬럼(PII 포함)으로 좁히는 검색이라 마스킹본 위에서도 「이 값이 명단에
 * 있는가」를 확인하는 오라클이 된다 — 게스트가 보는 것은 집계이지 명단 조회가 아니다.
 *
 * **정렬과 분류 기준 칩은 남긴다.** 둘 다 집계 축을 다루지 개별 행을 조회하지 않는다.
 * 표가 정렬 가능한 헤더를 그리므로 페이지가 그것을 받지 않으면 눌러도 아무 일이 없는
 * 죽은 컨트롤이 된다 — 차단이 아니라 고장으로 보인다. 해석은 운영 콘솔과 같은 함수
 * (`parseProgressSort`)를 쓴다.
 */
export default async function GuestReportPage({ params, searchParams }: Props) {
  const { surveyId } = await params;
  await assertGuestSurveyPageAccess(surveyId, 'progressReport');

  const sp = await searchParams;
  const pageRaw = Number(sp.page);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const dir: SortDir = sp.dir === 'asc' ? 'asc' : 'desc';

  const [scheme, groupLabel, contactScheme] = await Promise.all([
    getProgressColumnScheme(surveyId),
    getProgressGroupLabel(surveyId, GUEST_DATA_SCOPE),
    getContactColumnScheme(surveyId, GUEST_DATA_SCOPE),
  ]);

  const visibleColumns = scheme.columns.filter((c) => !c.hidden).sort((a, b) => a.order - b.order);
  const metaKeys = visibleColumns.map((c) => c.key).filter((k) => k.length > 0);

  const groupByCriteria: GroupByOption[] = resolveGroupCriteria(contactScheme).map((c) => ({
    key: c.key,
    label: c.label,
  }));
  // 해석은 운영 콘솔과 같은 함수다 — 두 화면이 같은 표를 그리므로 규칙도 하나여야 한다.
  const activeCriteria = resolveActiveGroupKeys(groupByCriteria, sp.groupBy);
  const activeKeys = activeCriteria.map((c) => c.key);
  const parsedSort = parseProgressSort(sp.sort, metaKeys, activeKeys);
  const titleLabel =
    activeCriteria.length > 0 ? activeCriteria.map((c) => c.label).join('·') : groupLabel;

  const showResid = scheme.showResid ?? true;
  // 보이지 않는 컬럼으로 정렬하면 순서가 설명되지 않는다 — 운영 콘솔과 같은 폴백.
  const sort = !showResid && parsedSort === 'firstResid' ? 'responseRate' : parsedSort;
  const residLabel =
    contactScheme?.columns.find((c) => c.source === FILTER_SOURCE.RESID)?.label?.trim() ||
    RESID_DEFAULT_LABEL;

  const isEmpty = (await countContactTargets(surveyId, GUEST_DATA_SCOPE)) === 0;
  const { rows, totals } = isEmpty
    ? { rows: [], totals: EMPTY_PROGRESS_TOTALS }
    : await Promise.all([
        getProgressRows({
          surveyId,
          scope: GUEST_DATA_SCOPE,
          condition: null,
          page,
          size: PAGE_SIZE,
          sort,
          dir,
          metaKeys,
          groupByKeys: activeKeys,
        }),
        getProgressTotals(surveyId, GUEST_DATA_SCOPE, null, activeKeys),
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
        // 운영 콘솔의 ProgressEmptyCard 를 쓰지 않는다 — 그 카드는 「조사 대상 업로드로
        // 가세요」라고 안내하는데 그 표면이 게스트에게는 없다.
        <GuestEmptyState title="조사 대상 명단이 없습니다." description="명단이 등록되면 그룹별 진척률이 여기에 표시됩니다." />
      ) : (
        <>
          {groupByCriteria.length > 0 && (
            <ProgressGroupByTabs options={groupByCriteria} activeKeys={activeKeys} />
          )}
          <ProgressTable
            rows={rows}
            totals={totals}
            metaColumns={visibleColumns}
            residLabel={residLabel}
            showResid={showResid}
            groupColumns={activeCriteria.map((c) => ({ key: c.key, label: c.label }))}
            page={page}
            size={PAGE_SIZE}
            sort={sort}
            dir={dir}
          />
        </>
      )}
    </main>
  );
}
