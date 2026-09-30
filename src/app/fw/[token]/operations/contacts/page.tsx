import type { Metadata } from 'next';

import { ContactsListView } from '@/features/operations/contacts/contacts-list-view';
import { fieldworkLinkOperationsBase } from '@/features/operations/operations-paths';
import { getOperationsDataScope } from '@/server/data-scope';
import { assertFieldworkLinkPageAccess } from '@/server/page-fieldwork-link-access';
import { loadContactsListPage } from '@/server/read-models/contacts-list-page';

export const metadata: Metadata = {
  title: '조사 대상 목록',
};

interface PageProps {
  params: Promise<{ token: string }>;
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
 * 외주가 보는 조사 대상 목록 — 내부 콘솔과 **같은 화면 정의**다 (ADR-0026, 티켓 06).
 *
 * 다른 것은 셋뿐이다: 주소 접두(`basePath`), 주체의 capability(다운로드·업로드·이월 임포트·
 * 대상 추가·컬럼 설정이 그려지지 않는다), 그리고 파티션.
 *
 * **파티션은 언제나 real 이다.** `getOperationsDataScope` 에 링크 주체를 넘기면 「내부가
 * 아니면 real」 술어가 그것을 정한다(스펙 §11-3) — 담당 연구원이 테스트 모드를 켠 설문에서
 * 외주가 test 파티션을 읽으면 밖에서 전화 돌리는 사람이 실제 연락처를 못 본다.
 *
 * 설문 id 는 **관문이 돌려준 값**만 쓴다. 주소에 실린 것은 토큰뿐이라 다른 설문을 지목할
 * 여지가 애초에 없다.
 */
export default async function FieldworkLinkContactsPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  // 상위 레이아웃은 소프트 내비게이션에서 다시 돌지 않는다 — 여기서 다시 묻는다(티켓 10).
  const { actor, surveyId, capabilities } = await assertFieldworkLinkPageAccess(
    token,
    'contacts.view',
  );
  const scope = await getOperationsDataScope(surveyId, actor);
  const data = await loadContactsListPage({
    surveyId,
    scope,
    // 링크에는 메일 탭 열람(`mail.view`)이 없다 — 「수신 상황」 열·필터·정렬이 통째로 빠진다.
    // 단건 발송(`mail.sendSingle`, ADR-0027)은 상세 화면의 일이라 이 표와 무관하다.
    canViewMail: capabilities.has('mail.view'),
    searchParams: await searchParams,
  });

  return (
    <ContactsListView
      surveyId={surveyId}
      basePath={fieldworkLinkOperationsBase(token)}
      capabilities={capabilities}
      // 단건 상세가 이 트리에 있다(티켓 08) — 목록의 주된 동작이 행 클릭이다.
      canOpenDetail
      data={data}
    />
  );
}
