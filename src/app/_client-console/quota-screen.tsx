import { QuotaStatusPanel } from '@/features/operations/quota/quota-status-panel';
import { GuestEmptyState } from '@/features/guest-console/guest-empty-state';
import { getQuotaStatus } from '@/server/quota/services/quota-status';

import { EXTERNAL_VIEWER_DATA_SCOPE } from '@/server/data-scope';

/**
 * 클라이언트 콘솔의 쿼터 현황 본문 — **두 입구가 함께 쓴다** (ADR-0029).
 *
 * 게스트 계정(`/guest/surveys/<id>`)과 클라이언트 링크(`/client/<token>`)가 같은 화면을 연다.
 * 두 트리의 page 는 관문과 주소 접두만 주고 조립은 여기 하나다 — 내부 콘솔과 외주 콘솔이
 * `src/app/_operations/` 를 함께 쓰는 것과 같은 방식이다. 화면을 따로 짜면 두 벌이 되어
 * 한쪽만 고쳐진다.
 *
 * **세션을 읽지 않는다.** 받는 것은 설문 id 와(필요하면) 주소 접두뿐이고, 파티션은 언제나
 * 실데이터 상수다 — 외부 주체는 테스트 모드와 무관하게 실데이터를 본다. 누가 들어왔는지는
 * 관문이 이미 답했고, 이 본문이 다시 물으면 계정 없는 링크 세션에서 던진다.
 *
 * .pen FLOW 5-2 칩 「쿼터 현황」, 스펙 §5.
 *
 * 운영 콘솔의 현황판을 그대로 쓴다 — 쿼터는 목표 대비 달성 집계라 게스트가 보는 것과
 * 담당자가 보는 것이 같아야 한다. **편집 화면(`/operations/quota`)은 게스트에게 없다**:
 * 이 탭이 여는 것은 현황판 하나이고 플랜 저장은 `survey.edit` 축이다.
 *
 * `isTestScope` 를 언제나 false 로 넘긴다 — 게스트 화면은 실데이터 고정이라(§11-3)
 * 테스트 파티션 경고가 뜰 상황 자체가 없다.
 */
export async function ClientQuotaScreen({ surveyId }: { surveyId: string }) {
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
