import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/operations/empty-state';
import { ContactsFilterBar } from '@/components/operations/contacts/contacts-filter-bar';
import { ContactsTable } from '@/components/operations/contacts/contacts-table';
import {
  CONTACTS_PAGE_SIZE,
  hasActiveContactFilters,
  normalizeContactListArgs,
} from '@/lib/operations/contacts';
import {
  getContactColumnScheme,
  listContactsForSurvey,
} from '@/lib/operations/contacts.server';

export const metadata: Metadata = {
  title: '현황 - 컨택리스트',
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page?: string;
    q?: string;
    qfield?: string;
    resultCode?: string;
    sort?: string;
    dir?: string;
  }>;
}

export default async function ContactsPage({ params, searchParams }: PageProps) {
  const { id: surveyId } = await params;
  const sp = await searchParams;
  const args = normalizeContactListArgs(sp);

  const [{ rows, total, page: clampedPage }, scheme] = await Promise.all([
    listContactsForSurvey({ surveyId, pageSize: CONTACTS_PAGE_SIZE, ...args }),
    getContactColumnScheme(surveyId),
  ]);

  if (!scheme) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-gray-900">컨택리스트</h2>
        </div>
        <Card>
          <CardContent className="px-5 py-4">
            <EmptyState
              message="아직 업로드된 컨택이 없습니다"
              description="엑셀 파일을 업로드해 명단을 적재하세요."
            />
            <div className="mt-4 flex justify-center">
              <Button asChild>
                <Link href={`/admin/surveys/${surveyId}/operations/contacts/upload/new`}>
                  엑셀 업로드
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  const hasFilter = hasActiveContactFilters(sp);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">컨택리스트</h2>
          <p className="text-sm text-slate-500">총 {total.toLocaleString('ko-KR')}건</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/admin/surveys/${surveyId}/operations/contacts/upload/new`}>+ 업로드</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="px-5 py-4 space-y-4">
          <ContactsFilterBar
            initialQ={args.q}
            initialQField={args.qfield}
            initialResultCode={args.resultCode}
            resultCodeOptions={[]}
          />
          {rows.length === 0 ? (
            <EmptyState
              message={hasFilter ? '검색 결과가 없습니다' : '컨택이 없습니다'}
              description={hasFilter ? '필터를 변경해 보세요.' : '엑셀로 명단을 업로드하세요.'}
            />
          ) : (
            <ContactsTable
              rows={rows}
              total={total}
              page={clampedPage}
              pageSize={CONTACTS_PAGE_SIZE}
              scheme={scheme}
              surveyId={surveyId}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
