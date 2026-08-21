import { notFound } from 'next/navigation';

import { OperationsPageHeader } from '@/features/operations/operations-page-header';
import { OperationsTabStrip } from '@/features/operations/operations-tab-strip';
import { getControlState } from '@/server/operations/services/control.service';
import { getSurveyById } from '@/server/survey-builder/services/survey-read.service';
import { isGuestViewer } from '@/lib/auth/guest-viewer';

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
  const [control, isGuest] = await Promise.all([getControlState(surveyId), isGuestViewer()]);
  // 위에서 설문 존재를 확인했으므로 null 은 그 사이 삭제된 극단 케이스 — 404 로 접는다.
  if (!control) notFound();

  return (
    <div className="min-h-screen bg-gray-50">
      <OperationsPageHeader
        surveyId={surveyId}
        surveyTitle={survey.title}
        isGuest={isGuest}
        control={control}
      />
      <OperationsTabStrip surveyId={surveyId} isGuest={isGuest} />
      {children}
    </div>
  );
}
