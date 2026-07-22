import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ColumnSchemeEditor } from '@/components/operations/contacts/column-scheme-editor';
import { getContactColumnScheme } from '@/lib/operations/contacts.server';
import { getOperationsDataScope } from '@/lib/operations/data-scope.server';

export const metadata: Metadata = {
  title: '현황 - 컬럼 설정',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ContactsColumnsPage({ params }: PageProps) {
  const { id: surveyId } = await params;
  const scope = await getOperationsDataScope(surveyId);
  const scheme = await getContactColumnScheme(surveyId, scope);
  if (!scheme) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">컬럼 설정</h2>
        <p className="text-sm text-slate-500">조사 대상 목록 표 컬럼 순서·라벨·표시 여부</p>
      </div>
      <ColumnSchemeEditor surveyId={surveyId} scheme={scheme} />
    </main>
  );
}
