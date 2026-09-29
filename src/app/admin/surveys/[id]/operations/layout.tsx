import { notFound } from 'next/navigation';

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveyDocuments } from '@/db/schema';
import { OperationsPageHeader } from '@/features/operations/operations-page-header';
import { OperationsTabStrip } from '@/features/operations/operations-tab-strip';
import { getControlState } from '@/server/operations/services/control';
import { getSurveyById } from '@/server/survey-builder/services/survey-read';
import { requireAuth } from '@/lib/auth';
import { loadSurveyCapabilities } from '@/server/survey-access';
import { adminOperationsBase } from '@/features/operations/operations-paths';

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
  // 관문은 상위 `[id]` 레이아웃이 survey.view 로 이미 졌다 — 여기서 다시 묻지 않고
  // 헤더·탭이 무엇을 그릴지 정할 판정 결과만 읽는다. 화면이 스스로 판정을 복제하지 않도록
  // 불리언이 아니라 capability 집합을 그대로 넘긴다.
  const viewer = await requireAuth();
  const [control, capabilities, documentRows] = await Promise.all([
    getControlState(surveyId),
    loadSurveyCapabilities(viewer, surveyId),
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
        capabilities={capabilities}
        control={control}
      />
      <OperationsTabStrip
        basePath={adminOperationsBase(surveyId)}
        capabilities={capabilities}
        hasSurveyDocument={documentRows.length > 0}
      />
      {children}
    </div>
  );
}
