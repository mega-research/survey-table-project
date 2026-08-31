import { QuotaStatusPanel } from '@/features/operations/quota/quota-status-panel';
import { GuestEmptyState } from '@/features/guest-console/guest-empty-state';
import { assertGuestSurveyPageAccess } from '@/server/page-guest-access';
import { getQuotaStatus } from '@/server/quota/services/quota-status';

import { EXTERNAL_VIEWER_DATA_SCOPE } from '@/server/data-scope';

interface Props {
  params: Promise<{ surveyId: string }>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '쿼터 현황' };

/**
 * 쿼터 현황 (.pen FLOW 5-2 칩 「쿼터 현황」, 스펙 §5).
 *
 * 운영 콘솔의 현황판을 그대로 쓴다 — 쿼터는 목표 대비 달성 집계라 게스트가 보는 것과
 * 담당자가 보는 것이 같아야 한다. **편집 화면(`/operations/quota`)은 게스트에게 없다**:
 * 이 탭이 여는 것은 현황판 하나이고 플랜 저장은 `survey.edit` 축이다.
 *
 * `isTestScope` 를 언제나 false 로 넘긴다 — 게스트 화면은 실데이터 고정이라(§11-3)
 * 테스트 파티션 경고가 뜰 상황 자체가 없다.
 */
export default async function GuestQuotaPage({ params }: Props) {
  const { surveyId } = await params;
  await assertGuestSurveyPageAccess(surveyId, 'quota');

  const status = await getQuotaStatus(surveyId, EXTERNAL_VIEWER_DATA_SCOPE);

  return (
    <main className="mx-auto max-w-7xl space-y-4 px-6 py-8">
      <div>
        <h2 className="text-xl font-bold text-gray-900">쿼터 현황</h2>
        <p className="text-sm text-slate-500">목표 대비 완료 응답 집계</p>
      </div>
      {status && status.cells.length > 0 ? (
        <QuotaStatusPanel status={status} isTestScope={false} />
      ) : (
        <GuestEmptyState
          title="설정된 쿼터가 없습니다."
          description="담당 연구원이 쿼터를 설정하면 달성 현황이 여기에 표시됩니다."
        />
      )}
    </main>
  );
}
