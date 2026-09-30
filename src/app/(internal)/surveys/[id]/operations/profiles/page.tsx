import type { Metadata } from 'next';

import { internalOperationsBase } from '@/features/operations/operations-paths';
import { getOperationsDataScope } from '@/server/data-scope';
import { assertSurveyConsolePageAccess } from '@/server/page-survey-access';

import { ProfilesScreen, type ProfilesSearchParams } from '@/app/_operations/profiles-screen';

export const metadata: Metadata = {
  title: '현황 - 응답 내역',
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<ProfilesSearchParams>;
}

/**
 * 운영 콘솔 응답 내역 페이지 — 본문은 외주 실사 링크 트리와 함께 쓴다(`_operations/profiles-screen`).
 */
export default async function ProfilesPage({ params, searchParams }: PageProps) {
  const { id: surveyId } = await params;
  // 상위 레이아웃은 소프트 내비게이션에서 다시 돌지 않는다 — 세션이 폐기된 뒤에도
  // 이 페이지가 서비스를 직접 불러 데이터를 렌더할 수 있어 여기서 다시 묻는다(티켓 10).
  const { capabilities } = await assertSurveyConsolePageAccess(surveyId, 'responses.view');
  const [sp, scope] = await Promise.all([searchParams, getOperationsDataScope(surveyId)]);

  return (
    <ProfilesScreen
      surveyId={surveyId}
      basePath={internalOperationsBase(surveyId)}
      capabilities={capabilities}
      scope={scope}
      searchParams={sp}
    />
  );
}
