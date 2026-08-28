import { GuestEmptyState } from '@/features/guest-console/guest-empty-state';
import {
  type GroupByOption,
  ProgressGroupByTabs,
} from '@/features/operations/report/progress-group-by-tabs';
import { ProgressTable } from '@/features/operations/report/progress-table';
import { resolveGroupCriteria } from '@/lib/contacts/group-levels';
import { RESID_DEFAULT_LABEL } from '@/lib/operations/contacts-format';
import { FILTER_SOURCE } from '@/lib/operations/filter-shared';
import { EMPTY_PROGRESS_TOTALS } from '@/lib/operations/report-progress-format';
import { assertGuestSurveyPageAccess } from '@/server/page-guest-access';
import { getContactColumnScheme } from '@/server/read-models/contacts';
import {
  countContactTargets,
  getProgressColumnScheme,
  getProgressGroupLabel,
  getProgressRows,
  getProgressTotals,
} from '@/server/operations/services/report-progress';

import { GUEST_SCOPE } from '../guest-operations';

interface Props {
  params: Promise<{ surveyId: string }>;
  searchParams: Promise<{ page?: string; groupBy?: string }>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '진척 보고' };

const PAGE_SIZE = 20;

/**
 * 진척 보고 — 그룹별 진척률 (.pen FLOW 5-2 칩 「진척 보고」, 스펙 §5).
 *
 * 운영 콘솔의 같은 표를 같은 서비스 위에 얹되 **필터 바와 정렬 조작을 뺀다**.
 *
 * 필터 바는 컨택 컬럼(PII 포함)으로 좁히는 검색이라 마스킹본 위에서도 「이 값이 명단에
 * 있는가」를 확인하는 오라클이 된다 — 게스트가 보는 것은 집계이지 명단 조회가 아니다.
 * 정렬을 응답률 내림차순으로 고정하는 것도 같은 축이다: 정렬 키가 열리면 그룹의 순위로
 * 개별 값을 역산할 여지가 생기고, 이 화면에는 그것을 요구하는 업무가 없다.
 *
 * 분류 기준 칩은 남긴다 — 그것은 **집계 축의 전환**이지 행 조회가 아니다.
 */
export default async function GuestReportPage({ params, searchParams }: Props) {
  const { surveyId } = await params;
  await assertGuestSurveyPageAccess(surveyId, 'progressReport');

  const { page: pageStr, groupBy } = await searchParams;
  const pageRaw = Number(pageStr);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;

  const [scheme, groupLabel, contactScheme] = await Promise.all([
    getProgressColumnScheme(surveyId),
    getProgressGroupLabel(surveyId, GUEST_SCOPE),
    getContactColumnScheme(surveyId, GUEST_SCOPE),
  ]);

  const visibleColumns = scheme.columns.filter((c) => !c.hidden).sort((a, b) => a.order - b.order);
  const metaKeys = visibleColumns.map((c) => c.key).filter((k) => k.length > 0);

  const groupByCriteria: GroupByOption[] = resolveGroupCriteria(contactScheme).map((c) => ({
    key: c.key,
    label: c.label,
  }));
  // 관리자 화면과 같은 해석 — 미지정이면 지정된 기준 전체, 콤마 목록이면 그 중 유효한 것만.
  const requestedKeys =
    typeof groupBy === 'string'
      ? groupBy
          .split(',')
          .map((k) => k.trim())
          .filter((k) => k.length > 0)
      : null;
  const matched =
    requestedKeys === null ? [] : groupByCriteria.filter((c) => requestedKeys.includes(c.key));
  const activeCriteria = matched.length > 0 ? matched : groupByCriteria;
  const activeKeys = activeCriteria.map((c) => c.key);
  const titleLabel =
    activeCriteria.length > 0 ? activeCriteria.map((c) => c.label).join('·') : groupLabel;

  const showResid = scheme.showResid ?? true;
  const residLabel =
    contactScheme?.columns.find((c) => c.source === FILTER_SOURCE.RESID)?.label?.trim() ||
    RESID_DEFAULT_LABEL;

  const isEmpty = (await countContactTargets(surveyId, GUEST_SCOPE)) === 0;
  const { rows, totals } = isEmpty
    ? { rows: [], totals: EMPTY_PROGRESS_TOTALS }
    : await Promise.all([
        getProgressRows({
          surveyId,
          scope: GUEST_SCOPE,
          condition: null,
          page,
          size: PAGE_SIZE,
          sort: 'responseRate',
          dir: 'desc',
          metaKeys,
          groupByKeys: activeKeys,
        }),
        getProgressTotals(surveyId, GUEST_SCOPE, null, activeKeys),
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
            sort="responseRate"
            dir="desc"
          />
        </>
      )}
    </main>
  );
}
