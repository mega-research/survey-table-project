import { notFound } from 'next/navigation';

import { OperationsPageHeader } from '@/components/operations/operations-page-header';
import { OperationsTabStrip } from '@/components/operations/operations-tab-strip';
import { TestModeBanner } from '@/components/operations/test-mode-banner';
import { getControlState } from '@/features/operations/server/services/control.service';
import { getSurveyById } from '@/features/survey-builder/server/services/survey-read.service';

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

/**
 * `/admin/surveys/[id]/operations/*` 공통 레이아웃.
 *
 * - 헤더(목록으로 + 제목 + 새로고침/편집)와 탭 스트립을 한 번만 렌더링.
 * - survey 존재 확인 + soft-delete 차단도 layout 단에서 일괄 처리.
 * - 하위 page.tsx 는 main 영역만 책임.
 */
export default async function OperationsLayout({ children, params }: LayoutProps) {
  const { id: surveyId } = await params;
  const survey = await getSurveyById(surveyId);
  if (!survey || survey.deletedAt) notFound();
  const control = await getControlState(surveyId);

  return (
    <div className="min-h-screen bg-gray-50">
      <OperationsPageHeader surveyId={surveyId} surveyTitle={survey.title} control={control} />
      <OperationsTabStrip surveyId={surveyId} />
      {control.testModeEnabled ? <TestModeBanner /> : null}
      {children}
    </div>
  );
}
