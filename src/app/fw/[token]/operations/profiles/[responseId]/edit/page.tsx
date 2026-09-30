import { fieldworkLinkOperationsBase } from '@/features/operations/operations-paths';
import { getOperationsDataScope } from '@/server/data-scope';
import { assertFieldworkLinkPageAccess } from '@/server/page-fieldwork-link-access';

import { parseResponseIdx } from '@/app/_operations/response-edit-idx';
import { ResponseEditScreen } from '@/app/_operations/response-edit-screen';

interface PageProps {
  params: Promise<{ token: string; responseId: string }>;
  searchParams: Promise<{ idx?: string }>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '응답 수정' };

/**
 * 외주가 응답을 고치는 화면 — 내부 콘솔과 **같은 본문**이다 (ADR-0027).
 *
 * 저장(`surveyResponse.edit.saveAdminEdit`)은 scoped 표면이라 링크 세션으로 지나고, 편집 이력에는
 * 계정 칸이 아니라 링크 칸이 남는다(0128). 응답은 관문이 돌려준 설문 id 로만 찾는다 — 주소의
 * responseId 가 남의 설문 것이면 read-model 의 WHERE 에서 떨어져 notFound 다.
 */
export default async function FieldworkLinkResponseEditPage({ params, searchParams }: PageProps) {
  const { token, responseId } = await params;
  // 상위 레이아웃은 소프트 내비게이션에서 다시 돌지 않는다 — 여기서 다시 묻는다(티켓 10).
  const { actor, surveyId } = await assertFieldworkLinkPageAccess(token, 'responses.view');
  const [sp, scope] = await Promise.all([searchParams, getOperationsDataScope(surveyId, actor)]);

  return (
    <ResponseEditScreen
      surveyId={surveyId}
      responseId={responseId}
      basePath={fieldworkLinkOperationsBase(token)}
      scope={scope}
      idx={parseResponseIdx(sp.idx)}
    />
  );
}
