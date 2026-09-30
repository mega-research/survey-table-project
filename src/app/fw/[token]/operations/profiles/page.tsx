import type { Metadata } from 'next';

import { fieldworkLinkOperationsBase } from '@/features/operations/operations-paths';
import { getOperationsDataScope } from '@/server/data-scope';
import { assertFieldworkLinkPageAccess } from '@/server/page-fieldwork-link-access';

import { ProfilesScreen, type ProfilesSearchParams } from '@/app/_operations/profiles-screen';

export const metadata: Metadata = {
  title: '응답 내역',
};

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<ProfilesSearchParams>;
}

/**
 * 외주가 보는 응답 내역 — 내부 콘솔과 **같은 본문**이다 (ADR-0026, ADR-0027).
 *
 * 외주는 응답을 열어 보고 고칠 수 있다(`responses.view`). 삭제·초기화·복원과 휴지통 보기는
 * `responses.manage` 라 그려지지 않고, 컬럼 설정은 `survey.edit` 이라 없다.
 *
 * 파티션은 언제나 real 이다 — 링크 주체를 넘기면 「내부가 아니면 real」 술어가 정한다.
 * 설문 id 는 관문이 돌려준 값만 쓴다(주소에는 토큰뿐이다).
 */
export default async function FieldworkLinkProfilesPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  // 상위 레이아웃은 소프트 내비게이션에서 다시 돌지 않는다 — 여기서 다시 묻는다(티켓 10).
  const { actor, surveyId, capabilities } = await assertFieldworkLinkPageAccess(
    token,
    'responses.view',
  );
  const [sp, scope] = await Promise.all([searchParams, getOperationsDataScope(surveyId, actor)]);

  return (
    <ProfilesScreen
      surveyId={surveyId}
      basePath={fieldworkLinkOperationsBase(token)}
      capabilities={capabilities}
      scope={scope}
      searchParams={sp}
    />
  );
}
