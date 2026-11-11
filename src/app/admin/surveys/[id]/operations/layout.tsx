import { requireSurveyConsolePage } from '@/lib/auth/require-survey-console-page';
import { notFound } from 'next/navigation';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveyDocuments } from '@/db/schema';
import { OperationsPageHeader } from '@/features/operations/operations-page-header';
import { OperationsTabStrip } from '@/features/operations/operations-tab-strip';
import { canOpenSurveyPreview, isGuestViewer, isViewOnlyViewer } from '@/lib/auth/guest-viewer';
import { getControlState } from '@/server/operations/services/control';
import { getSurveyById } from '@/server/survey-builder/services/survey-read';

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
  // 페이지 가드와 같은 판정을 헤더에도 — 페이지가 404 여도 레이아웃은 설문 제목을 그리기 때문이다.
  // 응답 현황·응답 내역이 이 레이아웃 아래라 보기 전용 게스트는 여기서 막지 않는다(페이지가 가른다).
  await requireSurveyConsolePage(surveyId, { viewOnly: 'allow' });
  const survey = await getSurveyById(surveyId);
  if (!survey || survey.deletedAt) notFound();
  const [control, isGuest, viewOnly, showPreview, documentRows] = await Promise.all([
    getControlState(surveyId),
    isGuestViewer(),
    isViewOnlyViewer(surveyId),
    canOpenSurveyPreview(surveyId),
    // 조사표가 붙은 설문에서만 '문항 수요' 탭을 낸다 — 다른 설문에는 쓸 일이 없다.
    db
      .select({ id: surveyDocuments.id })
      .from(surveyDocuments)
      .where(eq(surveyDocuments.surveyId, surveyId))
      .limit(1),
  ]);
  // 위에서 설문 존재를 확인했으므로 null 은 그 사이 삭제된 극단 케이스 — 404 로 접는다.
  if (!control) notFound();

  return (
    <div className="min-h-screen bg-gray-50">
      <OperationsPageHeader
        surveyId={surveyId}
        surveyTitle={survey.title}
        isGuest={isGuest}
        showPreview={showPreview}
        control={control}
      />
      <OperationsTabStrip
        surveyId={surveyId}
        isGuest={isGuest}
        viewOnly={viewOnly}
        hasSurveyDocument={documentRows.length > 0}
      />
      {children}
    </div>
  );
}
