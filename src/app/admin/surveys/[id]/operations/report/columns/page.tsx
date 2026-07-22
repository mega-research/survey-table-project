import type { Metadata } from 'next';
import Link from 'next/link';

import { ProgressColumnEditor } from '@/components/operations/report/progress-column-editor';
import { Button } from '@/components/ui/button';
import { getContactColumnScheme } from '@/lib/operations/contacts.server';
import { getProgressColumnScheme } from '@/lib/operations/report-progress.server';
import { getOperationsDataScope } from '@/lib/operations/data-scope.server';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '현황 - 진척률 컬럼 설정',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * 진척률 컬럼 설정 페이지.
 *
 * - server component: progress_columns(현재 스킴)와 contact_columns(attrs.* 풀) 를 병렬 조회.
 * - 실제 편집 인터랙션은 ProgressColumnEditor(client) 가 담당.
 */
export default async function ReportColumnsPage({ params }: PageProps) {
  const { id: surveyId } = await params;
  const scope = await getOperationsDataScope(surveyId);

  const [scheme, contactScheme] = await Promise.all([
    getProgressColumnScheme(surveyId),
    getContactColumnScheme(surveyId, scope),
  ]);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">진척률 컬럼 설정</h2>
          <p className="text-sm text-slate-500">진척률 표의 그룹 메타 컬럼 순서·라벨·표시 여부</p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/admin/surveys/${surveyId}/operations/report`}>← 진척률로</Link>
        </Button>
      </div>

      <ProgressColumnEditor
        surveyId={surveyId}
        initialScheme={scheme}
        contactScheme={contactScheme}
      />
    </main>
  );
}
