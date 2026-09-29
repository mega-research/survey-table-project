import type { Metadata } from 'next';

import { ContactsListView } from '@/features/operations/contacts/contacts-list-view';
import { adminOperationsBase } from '@/features/operations/operations-paths';
import { getOperationsDataScope } from '@/server/data-scope';
import { assertSurveyConsolePageAccess } from '@/server/page-survey-access';
import { loadContactsListPage } from '@/server/read-models/contacts-list-page';

export const metadata: Metadata = {
  title: '현황 - 조사 대상 목록',
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    col?: string | string[];
    q?: string | string[];
    op?: string | string[];
    hcol?: string | string[];
    hm?: string | string[];
    hv?: string | string[];
    page?: string;
    sort?: string;
    dir?: string;
  }>;
}

/**
 * 조사 대상 목록 — 화면 정의는 `ContactsListView` 가 갖고 여기는 관문·조립만 한다.
 *
 * 외주 실사 링크 트리(`/fw/[token]/operations/contacts`)가 **같은 뷰**를 다른 base·다른
 * capability 로 렌더한다(ADR-0026, 티켓 06). 그래서 이 파일에 화면을 되돌려 쓰지 말 것 —
 * 두 벌이 되는 순간 한쪽만 고쳐진다.
 */
export default async function ContactsPage({ params, searchParams }: PageProps) {
  const { id: surveyId } = await params;
  // 상위 레이아웃은 소프트 내비게이션에서 다시 돌지 않는다 — 세션이 폐기된 뒤에도
  // 이 페이지가 서비스를 직접 불러 데이터를 렌더할 수 있어 여기서 다시 묻는다(티켓 10).
  const { capabilities } = await assertSurveyConsolePageAccess(surveyId, 'contacts.view');
  const scope = await getOperationsDataScope(surveyId);
  const data = await loadContactsListPage({
    surveyId,
    scope,
    canViewMail: capabilities.has('mail.view'),
    searchParams: await searchParams,
  });

  return (
    <ContactsListView
      surveyId={surveyId}
      basePath={adminOperationsBase(surveyId)}
      capabilities={capabilities}
      canOpenDetail
      data={data}
    />
  );
}
