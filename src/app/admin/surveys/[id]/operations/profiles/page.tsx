import type { Metadata } from 'next';
import Link from 'next/link';

import { asc, eq } from 'drizzle-orm';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/features/operations/empty-state';
import { ProfilesFilterBar } from '@/features/operations/profiles/profiles-filter-bar';
import { ProfilesTable } from '@/features/operations/profiles/profiles-table';
import { getQuestionGroupsBySurvey } from '@/server/read-models/survey-structure';
import { db } from '@/db';
import { questions as questionsTable } from '@/db/schema';
import { getSurveyContactStats } from '@/server/operations/services/contact-stats';
import {
  PROFILES_PAGE_SIZE,
  buildStepLocationMap,
  hasActiveFilters,
  normalizeListArgs,
} from '@/lib/operations/profiles-format';
import { listResponsesForProfiles } from '@/server/operations/services/profiles';
import {
  hydrateProfileColumns,
  visibleProfileColumns,
} from '@/lib/operations/profile-columns-format';
import { getProfileColumnScheme } from '@/server/read-models/profile-column-scheme';
import { decryptPiiForTargets } from '@/lib/crypto/contact-pii-repo';
import { getContactColumnScheme, buildColumnCandidates } from '@/server/read-models/contacts';
import {
  parseProfilesClausesFromUrl,
  parseProfilesHeaderFiltersFromUrl,
  PROFILES_EXTRA_CANDIDATES,
} from '@/server/operations/services/profiles-filters';
import type { FilterClause } from '@/lib/operations/filter-shared';
import { FILTER_SOURCE } from '@/lib/operations/filter-shared';
import { getOperationsDataScope } from '@/server/data-scope';
import { isGuestViewer } from '@/lib/auth/guest-viewer';

export const metadata: Metadata = {
  title: '현황 - 응답 내역',
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page?: string;
    q?: string | string[];
    col?: string | string[];
    op?: string | string[];
    hcol?: string | string[];
    hm?: string | string[];
    hv?: string | string[];
    status?: string;
    sort?: string;
    dir?: string;
  }>;
}

/**
 * 운영 콘솔 응답 내역 페이지.
 *
 * 서버 페이지네이션 + URL state 동기화. 0건 케이스 분기:
 *  - 필터 활성 → ProfilesTable 의 "검색 결과가 없습니다" EmptyState
 *  - 필터 없는데도 0건 → 페이지 단의 "아직 응답이 없습니다"
 */
export default async function ProfilesPage({ params, searchParams }: PageProps) {
  const { id: surveyId } = await params;
  const sp = await searchParams;

  // col/q 는 다중 조건 필터로 전환돼 배열일 수 있다 — normalize 는 스칼라 파라미터만 받는다.
  const args = normalizeListArgs({
    ...(sp.page !== undefined ? { page: sp.page } : {}),
    ...(sp.status !== undefined ? { status: sp.status } : {}),
    ...(sp.sort !== undefined ? { sort: sp.sort } : {}),
    ...(sp.dir !== undefined ? { dir: sp.dir } : {}),
  });
  const [scope, isGuest] = await Promise.all([getOperationsDataScope(surveyId), isGuestViewer()]);

  const [contactScheme, profileScheme] = await Promise.all([
    getContactColumnScheme(surveyId, scope),
    getProfileColumnScheme(surveyId),
  ]);
  // 표시 컬럼 스킴 — NULL(미설정)이면 hydrate 가 기본 스킴(기존 9컬럼)을 만든다.
  const displayColumns = visibleProfileColumns(
    hydrateProfileColumns(contactScheme, profileScheme),
  );
  // 전체(system.all) 는 컨택 유무와 무관하게 상시 노출 — 컨택 없는 설문에서도
  // 브라우저 부분일치 전개(파서 훅)로 유효하다.
  const columnCandidates = [
    { source: FILTER_SOURCE.ALL, label: '전체' },
    ...PROFILES_EXTRA_CANDIDATES,
    ...buildColumnCandidates(contactScheme).filter(
      (c) =>
        c.source === 'system.resid' ||
        c.source.startsWith('attrs.') ||
        c.source.startsWith('pii.'),
    ),
  ];
  const builderClauses = parseProfilesClausesFromUrl(sp.col, sp.q, sp.op, columnCandidates);
  const headerClauses = parseProfilesHeaderFiltersFromUrl(sp.hcol, sp.hm, sp.hv, columnCandidates);
  // UI 가 상호배타를 강제하므로 정상 흐름에선 한쪽만 존재.
  // URL 직접 조작으로 둘 다 있으면 AND 결합으로 무해하게 처리 (조사 대상과 동일).
  const clauses: FilterClause[] = [
    ...builderClauses,
    ...headerClauses.map((c, i) => ({
      condition: c.condition,
      op: builderClauses.length === 0 && i === 0 ? null : ('AND' as const),
    })),
  ];

  // 번호(ID) 열 노출 판정 — 엑셀 내보내기와 조건부 규칙 공유(설문 설정 기준, 매칭 무관).
  // 목록 쿼리보다 먼저 조회해 고아 sort(컨택 없는데 ?sort=resid 잔존 URL)를 순번 정렬로 폴백한다.
  // attrs.<key> 정렬은 표시 스킴에 있는 컬럼만 허용 (URL 직접 조작 가드) — 없으면 순번 폴백.
  const { hasContacts } = await getSurveyContactStats(surveyId, scope);
  const visibleAttrsSortKeys = new Set(
    displayColumns.map((c) => c.key).filter((k) => k.startsWith('attrs.')),
  );
  const sort =
    (!hasContacts && args.sort === 'resid') ||
    (args.sort.startsWith('attrs.') && !visibleAttrsSortKeys.has(args.sort))
      ? 'idx'
      : args.sort;

  const [{ rows, total, page: clampedPage }, qs, groups] = await Promise.all([
    listResponsesForProfiles({
      surveyId,
      scope,
      pageSize: PROFILES_PAGE_SIZE,
      page: args.page,
      status: args.status,
      sort,
      dir: args.dir,
      view: args.view,
      clauses,
    }),
    db
      .select({
        id: questionsTable.id,
        order: questionsTable.order,
        title: questionsTable.title,
        type: questionsTable.type,
        groupId: questionsTable.groupId,
        questionCode: questionsTable.questionCode,
        // 그룹 없이 pageBreakBefore 로만 페이지를 나누는 설문에서 이 필드가 빠지면
        // buildRenderSteps 가 전체를 한 페이지로 계산해 stepLocations 매칭이 전부 미스난다
        pageBreakBefore: questionsTable.pageBreakBefore,
      })
      .from(questionsTable)
      .where(eq(questionsTable.surveyId, surveyId))
      .orderBy(asc(questionsTable.order), asc(questionsTable.id)),
    getQuestionGroupsBySurvey(surveyId),
  ]);

  // 표시 스킴의 pii.* 컬럼만 현재 페이지 행 단위로 일괄 복호화.
  const piiKeys = displayColumns
    .filter((c) => c.key.startsWith('pii.'))
    .map((c) => c.key.slice('pii.'.length));
  const piiTargetIds = rows
    .map((r) => r.contactTargetId)
    .filter((id): id is string => id !== null);
  const piiByTarget =
    piiKeys.length > 0 && piiTargetIds.length > 0
      ? Object.fromEntries(await decryptPiiForTargets(piiTargetIds, piiKeys))
      : {};

  // currentStepId(페이지 step ID) → 대표 질문 order/번호 역매핑. 진행중 응답의 N/M·Qx 표기에 사용.
  const stepLocations = Object.fromEntries(buildStepLocationMap(qs, groups));
  const totalSteps = qs.length;

  const hasFilter = clauses.length > 0 || hasActiveFilters({ status: args.status });

  return (
    // 응답 내역은 컬럼 설정으로 열이 늘 수 있어 다른 운영 탭(max-w-7xl)보다 넓게 쓴다
    <main className="mx-auto max-w-[1440px] px-6 py-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            {args.view === 'deleted' ? '삭제된 응답' : '응답 내역'}
          </h2>
          <p className="text-sm text-slate-500">
            {args.view === 'deleted'
              ? `삭제된 응답 — ${total.toLocaleString('ko-KR')}건. 복원하면 통계에 다시 포함됩니다.`
              : `응답자별 세션 트래킹 — ${total.toLocaleString('ko-KR')}건`}
          </p>
        </div>
        {!isGuest && (
          <Button asChild variant="outline">
            <Link href={`/admin/surveys/${surveyId}/operations/profiles/columns`}>
              컬럼 설정
            </Link>
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="px-5 py-4">
          <div className="mb-4">
            <ProfilesFilterBar
              initialClauses={builderClauses.map((c) => ({
                op: c.op,
                source: c.condition.source,
                value: c.condition.value,
              }))}
              initialStatus={args.status}
              columnCandidates={columnCandidates}
            />
          </div>

          {total === 0 && !hasFilter ? (
            <EmptyState
              message={args.view === 'deleted' ? '삭제된 응답이 없습니다' : '아직 응답이 없습니다'}
              description={args.view === 'deleted' ? '응답을 삭제하면 여기에 모입니다' : '응답이 들어오면 여기에 표시됩니다'}
            />
          ) : (
            <ProfilesTable
              rows={rows}
              total={total}
              page={clampedPage}
              pageSize={PROFILES_PAGE_SIZE}
              sort={sort}
              dir={args.dir}
              stepLocations={stepLocations}
              totalSteps={totalSteps}
              surveyId={surveyId}
              view={args.view}
              hasContacts={hasContacts}
              isGuest={isGuest}
              columnScheme={displayColumns}
              piiByTarget={piiByTarget}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
