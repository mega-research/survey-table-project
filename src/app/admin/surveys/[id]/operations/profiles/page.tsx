import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { asc, eq } from 'drizzle-orm';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/operations/empty-state';
import { OperationsTabStrip } from '@/components/operations/operations-tab-strip';
import { ProfilesFilterBar } from '@/components/operations/profiles/profiles-filter-bar';
import { ProfilesTable } from '@/components/operations/profiles/profiles-table';
import { getSurveyById } from '@/data/surveys';
import { db } from '@/db';
import { questions as questionsTable } from '@/db/schema';
import {
  PROFILES_PAGE_SIZE,
  listResponsesForProfiles,
  normalizeListArgs,
} from '@/lib/operations/profiles.server';

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
 * - 서버 페이지네이션 + URL state 동기화
 * - questions 메타는 진척률(N/M·Qx) 계산에만 사용 → id/order/title 만 가져온다
 * - rows 0건 분기:
 *     · 검색·필터가 걸려 있으면 ProfilesTable 내부의 EmptyState ("검색 결과가 없습니다")
 *     · 필터 없는데도 0건이면 페이지 단의 "아직 응답이 없습니다"
 */
export default async function ProfilesPage({ params, searchParams }: PageProps) {
  const { id: surveyId } = await params;
  const sp = await searchParams;

  const survey = await getSurveyById(surveyId);
  if (!survey || survey.deletedAt) notFound();

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

  const hasFilter =
    (sp.q ?? '') !== '' ||
    (sp.qfield ?? 'all') !== 'all' ||
    (sp.status ?? 'all') !== 'all';

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/surveys">
              <ArrowLeft className="mr-1 size-4" /> 설문 목록으로
            </Link>
          </Button>
          <div className="ml-2">
            <div className="text-sm font-semibold text-slate-900">운영 콘솔</div>
            <div className="text-xs text-slate-500">{survey.title}</div>
          </div>
        </div>
        <OperationsTabStrip surveyId={surveyId} />
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-slate-900">응답자 목록</h2>
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
    </div>
  );
}
