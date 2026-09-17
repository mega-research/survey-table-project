import type { Metadata } from 'next';
import { ContactUploadAction } from '@/features/operations/contacts/contact-upload-action';
import { UploadHistoryTable } from '@/features/operations/contacts/upload-history-table';
import { Card, CardContent } from '@/components/ui/card';
import { listContactUploads } from '@/server/read-models/contacts';
import { getOperationsDataScope } from '@/server/data-scope';
import { requireAdminPage } from '@/lib/auth/require-admin-page';
import { assertSurveyCapabilityPage } from '@/server/page-survey-access';

export const metadata: Metadata = {
  title: '현황 - 조사 대상 업로드',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ContactsUploadPage({ params }: PageProps) {
  // 게스트 차단 화면 — admin 레이아웃의 경로 가드는 소프트 내비게이션에서 재실행되지 않으므로
  // 페이지가 스스로 막는다(페이지는 내비게이션마다 반드시 다시 렌더된다). 업로드 이력은
  // 명단 적재 동선이라 contacts.manage 관문을 지난다 (티켓 10).
  const viewer = await requireAdminPage();
  const { id: surveyId } = await params;
  await assertSurveyCapabilityPage(viewer, surveyId, 'contacts.manage');
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
