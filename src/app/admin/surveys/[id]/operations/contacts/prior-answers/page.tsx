import type { Metadata } from 'next';

import { PriorAnswerImportWizard } from '@/components/operations/contacts/prior-answer-import-wizard';
import {
  countPriorAnswerTargets,
  listPriorAnswerMatchFields,
} from '@/features/contacts/server/services/prior-answer-import.service';
import { getOperationsDataScope } from '@/lib/operations/data-scope.server';

export const metadata: Metadata = {
  title: '현황 - 이월 응답 임포트',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * 이월 응답 임포트 — 조사 대상 명단 업로드와 **분리된** 화면(추적조사).
 *
 * 매핑은 문항이 존재해야 가능하므로 명단 업로드와 시점이 다르고, 명단 업로드의 replace
 * 모드는 조사 대상을 전부 지우고 다시 넣어 개별 링크를 재발급한다 — 매핑을 고치려고
 * 그 경로를 다시 타면 이미 발송한 링크가 전부 죽는다.
 *
 * 명단 업로드와 달리 테스트 모드에서도 막지 않는다 — 테스트 조사 대상에게 이월 응답을
 * 붙여 발송 전에 화면을 확인하는 것이 이 기능의 요구사항이다. 어느 파티션에 붙는지는
 * 화면에서 분명히 알린다.
 */
export default async function PriorAnswersImportPage({ params }: PageProps) {
  const { id: surveyId } = await params;
  const scope = await getOperationsDataScope(surveyId);
  const [existingPriorAnswerCount, matchFields] = await Promise.all([
    countPriorAnswerTargets(surveyId, scope === 'test'),
    listPriorAnswerMatchFields(surveyId),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">이월 응답 임포트</h2>
        <p className="text-sm text-slate-500">
          지난 회차 rawdata 를 조사 대상에게 붙입니다. 조사 대상이 개별 링크로 들어오면 이 값이
          채워져 보입니다.
        </p>
      </div>
      <PriorAnswerImportWizard
        surveyId={surveyId}
        existingPriorAnswerCount={existingPriorAnswerCount}
        isTestScope={scope === 'test'}
        matchFields={matchFields}
      />
    </main>
  );
}
