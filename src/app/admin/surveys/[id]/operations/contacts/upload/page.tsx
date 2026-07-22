import type { Metadata } from 'next';
import { ContactUploadAction } from '@/components/operations/contacts/contact-upload-action';
import { UploadHistoryTable } from '@/components/operations/contacts/upload-history-table';
import { Card, CardContent } from '@/components/ui/card';
import { listContactUploads } from '@/lib/operations/contacts.server';
import { getOperationsDataScope } from '@/lib/operations/data-scope.server';

export const metadata: Metadata = {
  title: '현황 - 조사 대상 업로드',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ContactsUploadPage({ params }: PageProps) {
  const { id: surveyId } = await params;
  const scope = await getOperationsDataScope(surveyId);
  const rows = scope === 'test' ? null : await listContactUploads(surveyId);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">조사 대상 업로드</h2>
          <p className="text-sm text-slate-500">
            엑셀 파일 업로드 이력 — 총 {(rows?.length ?? 0).toLocaleString('ko-KR')}건
          </p>
        </div>
        <ContactUploadAction
          href={`/admin/surveys/${surveyId}/operations/contacts/upload/new`}
          label="새 업로드"
          disabled={scope === 'test'}
        />
      </div>

      {scope === 'test' ? (
        <Card>
          <CardContent className="p-6 text-sm text-slate-700">
            테스트 모드에서는 실제 조사대상자를 업로드할 수 없습니다.
          </CardContent>
        </Card>
      ) : (
        <UploadHistoryTable surveyId={surveyId} rows={rows ?? []} />
      )}
    </main>
  );
}
