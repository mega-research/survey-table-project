import type { Metadata } from 'next';

import { UploadWizard } from '@/components/operations/contacts/upload-wizard';
import { Card, CardContent } from '@/components/ui/card';
import { getExistingContactsCount } from '@/features/contacts/server/services/contact-columns.service';
import { countPriorAnswerTargets } from '@/features/contacts/server/services/prior-answer-import.service';
import { getContactColumnScheme } from '@/lib/operations/contacts.server';
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
