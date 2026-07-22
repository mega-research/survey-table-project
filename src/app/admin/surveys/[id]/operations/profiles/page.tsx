import type { Metadata } from 'next';

import { asc, eq } from 'drizzle-orm';

import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/operations/empty-state';
import { ProfilesFilterBar } from '@/components/operations/profiles/profiles-filter-bar';
import { ProfilesTable } from '@/components/operations/profiles/profiles-table';
import { getQuestionGroupsBySurvey } from '@/data/surveys';
import { db } from '@/db';
import { questions as questionsTable } from '@/db/schema';
import {
  PROFILES_PAGE_SIZE,
  buildStepLocationMap,
  hasActiveFilters,
  normalizeListArgs,
} from '@/lib/operations/profiles';
import { listResponsesForProfiles } from '@/lib/operations/profiles.server';
import { getContactColumnScheme, buildColumnCandidates } from '@/lib/operations/contacts.server';
import { parseProfilesCondition, PROFILES_EXTRA_CANDIDATES } from '@/lib/operations/profiles-filters.server';
import { getOperationsDataScope } from '@/lib/operations/data-scope.server';

export const metadata: Metadata = {
  title: '현황 - 응답 내역',
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page?: string;
    q?: string;
    col?: string;
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

  const args = normalizeListArgs(sp);
  const scope = await getOperationsDataScope(surveyId);

  const contactScheme = await getContactColumnScheme(surveyId, scope);
  const columnCandidates = [
    ...PROFILES_EXTRA_CANDIDATES,
    ...buildColumnCandidates(contactScheme).filter(
      (c) =>
        c.source === 'system.resid' ||
        c.source.startsWith('attrs.') ||
        c.source.startsWith('pii.'),
    ),
  ];
  const condition = parseProfilesCondition(args.col, args.q, columnCandidates);

  const [{ rows, total, page: clampedPage }, qs, groups] = await Promise.all([
    listResponsesForProfiles({
      surveyId,
      scope,
      pageSize: PROFILES_PAGE_SIZE,
      page: args.page,
      status: args.status,
      sort: args.sort,
      dir: args.dir,
      view: args.view,
      condition,
    }),
    db
      .select({
        id: questionsTable.id,
        order: questionsTable.order,
        title: questionsTable.title,
        type: questionsTable.type,
        groupId: questionsTable.groupId,
      })
      .from(questionsTable)
      .where(eq(questionsTable.surveyId, surveyId))
      .orderBy(asc(questionsTable.order), asc(questionsTable.id)),
    getQuestionGroupsBySurvey(surveyId),
  ]);

  // currentStepId(페이지 step ID) → 대표 질문 order/번호 역매핑. 진행중 응답의 N/M·Qx 표기에 사용.
  const stepLocations = Object.fromEntries(buildStepLocationMap(qs, groups));
  const totalSteps = qs.length;

  const hasFilter = hasActiveFilters(sp);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">
          {args.view === 'deleted' ? '삭제된 응답' : '응답 내역'}
        </h2>
        <p className="text-sm text-slate-500">
          {args.view === 'deleted'
            ? `삭제된 응답 — ${total.toLocaleString('ko-KR')}건. 복원하면 통계에 다시 포함됩니다.`
            : `응답자별 세션 트래킹 — ${total.toLocaleString('ko-KR')}건`}
        </p>
      </div>

      <Card>
        <CardContent className="px-5 py-4">
          <div className="mb-4">
            <ProfilesFilterBar
              initialSource={args.col}
              initialValue={args.q}
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
              sort={args.sort}
              dir={args.dir}
              stepLocations={stepLocations}
              totalSteps={totalSteps}
              surveyId={surveyId}
              view={args.view}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
