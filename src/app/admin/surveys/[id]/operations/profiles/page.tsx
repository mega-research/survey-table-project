import type { Metadata } from 'next';

import { asc, eq } from 'drizzle-orm';

import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/operations/empty-state';
import { ProfilesFilterBar } from '@/components/operations/profiles/profiles-filter-bar';
import { ProfilesTable } from '@/components/operations/profiles/profiles-table';
import { db } from '@/db';
import { questions as questionsTable } from '@/db/schema';
import {
  PROFILES_PAGE_SIZE,
  hasActiveFilters,
  normalizeListArgs,
} from '@/lib/operations/profiles';
import { listResponsesForProfiles } from '@/lib/operations/profiles.server';

export const metadata: Metadata = {
  title: '현황 - 응답자 목록',
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page?: string;
    q?: string;
    qfield?: string;
    status?: string;
    sort?: string;
    dir?: string;
  }>;
}

/**
 * 운영 콘솔 응답자 목록 페이지.
 *
 * 서버 페이지네이션 + URL state 동기화. 0건 케이스 분기:
 *  - 필터 활성 → ProfilesTable 의 "검색 결과가 없습니다" EmptyState
 *  - 필터 없는데도 0건 → 페이지 단의 "아직 응답이 없습니다"
 */
export default async function ProfilesPage({ params, searchParams }: PageProps) {
  const { id: surveyId } = await params;
  const sp = await searchParams;

  const args = normalizeListArgs(sp);

  const [{ rows, total, page: clampedPage }, qs] = await Promise.all([
    listResponsesForProfiles({
      surveyId,
      pageSize: PROFILES_PAGE_SIZE,
      ...args,
    }),
    db
      .select({
        id: questionsTable.id,
        order: questionsTable.order,
        title: questionsTable.title,
      })
      .from(questionsTable)
      .where(eq(questionsTable.surveyId, surveyId))
      .orderBy(asc(questionsTable.order), asc(questionsTable.id)),
  ]);

  const hasFilter = hasActiveFilters(sp);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">응답자 목록</h2>
        <p className="text-sm text-slate-500">
          응답자별 세션 트래킹 — {total.toLocaleString('ko-KR')}건
        </p>
      </div>

      <Card>
        <CardContent className="px-5 py-4">
          <div className="mb-4">
            <ProfilesFilterBar
              initialQ={args.q}
              initialQField={args.qfield}
              initialStatus={args.status}
            />
          </div>

          {total === 0 && !hasFilter ? (
            <EmptyState
              message="아직 응답이 없습니다"
              description="응답이 들어오면 여기에 표시됩니다"
            />
          ) : (
            <ProfilesTable
              rows={rows}
              total={total}
              page={clampedPage}
              pageSize={PROFILES_PAGE_SIZE}
              sort={args.sort}
              dir={args.dir}
              questions={qs}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
