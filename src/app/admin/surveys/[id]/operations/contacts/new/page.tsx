import { requireSurveyConsolePage } from '@/lib/auth/require-survey-console-page';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ContactDetailForm } from '@/features/operations/contacts/contact-detail-form';
import { extractSystemFieldKeys } from '@/lib/operations/contacts-shared';
import {
  getContactColumnScheme,
  getContactResultCodes,
} from '@/server/read-models/contacts';
import { getOperationsDataScope } from '@/server/data-scope';

export const metadata: Metadata = {
  title: '현황 - 조사 대상 추가',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ContactNewPage({ params }: PageProps) {
  const { id: surveyId } = await params;
  // 미들웨어를 통과한 무권한 세션을 거른다 — 이 설문에 접근할 수 있는 계정만.
  // 담당 범위에 묶인 게스트에게도 연다 — 이 화면은 스킴·결과코드만 읽고, 저장(`contacts.targets.add`)이
  // 추가하는 대상에 그 계정의 범위 값을 찍는다.
  await requireSurveyConsolePage(surveyId, { share: 'allow' });
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
