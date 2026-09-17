import type { Metadata } from 'next';

import { UploadWizard } from '@/features/operations/contacts/upload-wizard';
import { Card, CardContent } from '@/components/ui/card';
import { getExistingContactsCount } from '@/server/contacts/services/contact-columns';
import { countPriorAnswerTargets } from '@/server/contacts/services/prior-answer-import';
import { getContactColumnScheme } from '@/server/read-models/contacts';
import { getOperationsDataScope } from '@/server/data-scope';
import { requireAdminPage } from '@/lib/auth/require-admin-page';
import { assertSurveyCapabilityPage } from '@/server/page-survey-access';

export const metadata: Metadata = {
  title: '현황 - 엑셀 업로드',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ContactsUploadNewPage({ params }: PageProps) {
  const { id: surveyId } = await params;
  // 상위 레이아웃은 소프트 내비게이션에서 다시 돌지 않는다 — 세션이 폐기된 뒤에도
  // 이 페이지가 서비스를 직접 불러 데이터를 렌더할 수 있어 여기서 다시 묻는다.
  // 게스트는 admin 레이아웃의 경로 가드(guestPathRedirect 의 blockedSubpaths)가 업로드
  // 경로를 접지만 그 레이아웃은 소프트 내비게이션에서 재실행되지 않는다 — 여기서도
  // 형제 업로드 페이지와 같은 requireAdminPage + contacts.manage 짝으로 막는다 (티켓 10).
  const viewer = await requireAdminPage();
  await assertSurveyCapabilityPage(viewer, surveyId, 'contacts.manage');
  const scope = await getOperationsDataScope(surveyId);
  // 아래 테스트 스코프 차단으로 좁혀지기 전에 잡아둔다 — 리터럴 false 로 두면 그 가드가
  // 완화될 때 조용히 실 파티션을 읽는다.
  const isTestScope = scope === 'test';
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
  // 명단 replace 는 조사 대상을 지워 이월 응답까지 연쇄 삭제한다 — 되돌릴 수 없으니 미리 알린다.
  const existingPriorAnswerCount = await countPriorAnswerTargets(surveyId, isTestScope);
  const existingScheme = await getContactColumnScheme(surveyId, scope);

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">엑셀 업로드</h2>
        <p className="text-sm text-slate-500">조사 대상 명단을 엑셀 .xlsx 로 적재합니다.</p>
      </div>
      <UploadWizard
        surveyId={surveyId}
        existingPriorAnswerCount={existingPriorAnswerCount}
        existingContactsCount={existingContactsCount}
        existingScheme={existingScheme}
      />
    </main>
  );
}
