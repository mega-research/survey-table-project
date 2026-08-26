import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ColumnSchemeEditor } from '@/features/operations/contacts/column-scheme-editor';
import { getContactColumnScheme } from '@/server/read-models/contacts';
import { getOperationsDataScope } from '@/server/data-scope';
import { requireAdminPage } from '@/lib/auth/require-admin-page';

export const metadata: Metadata = {
  title: '현황 - 컬럼 설정',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ContactsColumnsPage({ params }: PageProps) {
  // 게스트 차단 화면 — admin 레이아웃의 경로 가드는 소프트 내비게이션에서 재실행되지 않으므로
  // 페이지가 스스로 막는다(페이지는 내비게이션마다 반드시 다시 렌더된다).
  await requireAdminPage();
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
