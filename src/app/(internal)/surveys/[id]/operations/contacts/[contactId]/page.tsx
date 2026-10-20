import type { Metadata } from 'next';

import { internalOperationsBase } from '@/features/operations/operations-paths';
import { getOperationsDataScope } from '@/server/data-scope';
import { assertSurveyConsolePageAccess } from '@/server/page-survey-access';

import { ContactDetailScreen } from '@/app/_operations/contact-detail-screen';

export const metadata: Metadata = {
  title: '현황 - 조사 대상 단건 편집',
};

interface PageProps {
  params: Promise<{ id: string; contactId: string }>;
}

/**
 * 조사 대상 단건 편집 — 화면 정의는 `ContactDetailScreen` 이 갖고 여기는 관문·주체 해석만 한다.
 *
 * 외주 실사 링크 트리(`/fw/[token]/operations/contacts/[contactId]`)가 **같은 본문**을 다른
 * capability 로 렌더한다(ADR-0026, 티켓 08).
 */
export default async function ContactDetailPage({ params }: PageProps) {
  const { id: surveyId, contactId } = await params;
  // 상위 레이아웃은 소프트 내비게이션에서 다시 돌지 않는다 — 세션이 폐기된 뒤에도
  // 이 페이지가 서비스를 직접 불러 데이터를 렌더할 수 있어 여기서 다시 묻는다(티켓 10).
  const { capabilities } = await assertSurveyConsolePageAccess(surveyId, 'contacts.view');
  const scope = await getOperationsDataScope(surveyId);

  return (
    <ContactDetailScreen
      surveyId={surveyId}
      contactId={contactId}
      basePath={internalOperationsBase(surveyId)}
      capabilities={capabilities}
      scope={scope}
      // 연구원은 종전대로 초대 링크를 본다 — 발송 문의·수동 안내에 쓰는 값이다.
      canProxyRespond
      includeContactOwner
    />
  );
}
