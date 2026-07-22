import type { Metadata } from 'next';

import { UploadWizard } from '@/components/operations/contacts/upload-wizard';
import { Card, CardContent } from '@/components/ui/card';
import { getExistingContactsCount } from '@/features/contacts/server/services/contact-columns.service';
import { getOperationsDataScope } from '@/lib/operations/data-scope.server';

export const metadata: Metadata = {
  title: '현황 - 엑셀 업로드',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ContactsUploadNewPage({ params }: PageProps) {
  const { id: surveyId } = await params;
  const scope = await getOperationsDataScope(surveyId);
  if (scope === 'test') {
    return (
      <main className="mx-auto max-w-3xl px-6 py-8">
        <Card>
          <CardContent className="p-6 text-sm text-slate-700">
            테스트 모드에서는 실제 조사대상자를 업로드할 수 없습니다.
          </CardContent>
        </Card>
      </main>
    );
  }
  const existingContactsCount = await getExistingContactsCount(surveyId, scope);

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">엑셀 업로드</h2>
        <p className="text-sm text-slate-500">조사 대상 명단을 엑셀 .xlsx 로 적재합니다.</p>
      </div>
      <UploadWizard surveyId={surveyId} existingContactsCount={existingContactsCount} />
    </main>
  );
}
