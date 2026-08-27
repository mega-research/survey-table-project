import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ContactDetailForm } from '@/features/operations/contacts/contact-detail-form';
import { extractSystemFieldKeys } from '@/lib/operations/contacts-shared';
import {
  getContactColumnScheme,
  getContactResultCodes,
} from '@/server/read-models/contacts';
import { getOperationsDataScope } from '@/server/data-scope';
import { assertSurveyConsolePageAccess } from '@/server/page-survey-access';

export const metadata: Metadata = {
  title: '현황 - 조사 대상 추가',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ContactNewPage({ params }: PageProps) {
  const { id: surveyId } = await params;
  // 상위 레이아웃은 소프트 내비게이션에서 다시 돌지 않는다 — 세션이 폐기된 뒤에도
  // 이 페이지가 서비스를 직접 불러 데이터를 렌더할 수 있어 여기서 다시 묻는다(티켓 10).
  // 조사 대상을 새로 만드는 화면이라 열람(contacts.view)이 아니라 contacts.manage 를 요구한다.
  await assertSurveyConsolePageAccess(surveyId, 'contacts.manage');
  const scope = await getOperationsDataScope(surveyId);

  const [scheme, resultCodes] = await Promise.all([
    getContactColumnScheme(surveyId, scope),
    getContactResultCodes(surveyId),
  ]);
  if (!scheme) notFound();

  return (
    <main className="mx-auto max-w-7xl px-6 py-6">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">조사 대상 추가</h2>
        <p className="text-sm text-slate-500">새 조사 대상을 직접 추가합니다.</p>
      </div>

      <ContactDetailForm
        surveyId={surveyId}
        scheme={scheme}
        resultCodes={resultCodes}
        systemFieldKeys={extractSystemFieldKeys(scheme)}
      />
    </main>
  );
}
