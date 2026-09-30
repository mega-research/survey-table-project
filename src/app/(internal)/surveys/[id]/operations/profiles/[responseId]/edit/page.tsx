import { internalOperationsBase } from '@/features/operations/operations-paths';
import { getOperationsDataScope } from '@/server/data-scope';
import { assertSurveyConsolePageAccess } from '@/server/page-survey-access';

import { parseResponseIdx } from '@/app/_operations/response-edit-idx';
import { ResponseEditScreen } from '@/app/_operations/response-edit-screen';

interface PageProps {
  params: Promise<{ id: string; responseId: string }>;
  searchParams: Promise<{ idx?: string }>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '응답 수정' };

/**
 * 어드민 응답 수정 라우트 — 본문은 외주 실사 링크 트리와 함께 쓴다(`_operations/response-edit-screen`).
 *
 * 인증 + 설문 단위 capability 가드(responses.view). 없는 설문과 권한 없는 설문을 똑같이
 * notFound 로 접는다 — 콘솔에서 남의 팀 설문의 **존재**를 알려줄 이유가 없다.
 */
export default async function AdminResponseEditPage({ params, searchParams }: PageProps) {
  const { id: surveyId, responseId } = await params;
  // 상위 레이아웃은 소프트 내비게이션에서 다시 돌지 않는다 — 세션이 폐기된 뒤에도
  // 이 페이지가 서비스를 직접 불러 데이터를 렌더할 수 있어 여기서 다시 묻는다(티켓 10).
  await assertSurveyConsolePageAccess(surveyId, 'responses.view');
  const [sp, scope] = await Promise.all([searchParams, getOperationsDataScope(surveyId)]);

  return (
    <ResponseEditScreen
      surveyId={surveyId}
      responseId={responseId}
      basePath={internalOperationsBase(surveyId)}
      scope={scope}
      idx={parseResponseIdx(sp.idx)}
    />
  );
}
