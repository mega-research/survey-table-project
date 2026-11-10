import type { Metadata } from 'next';

import { GuestEmptyState } from '@/features/guest-console/guest-empty-state';
import { QuotaStatusPanel } from '@/features/operations/quota/quota-status-panel';
import { ShareQuotaStatusPanel } from '@/features/operations/quota/share-quota-status-panel';
import { EXTERNAL_VIEWER_DATA_SCOPE } from '@/server/data-scope';
import { resolveFieldworkShare } from '@/server/fieldwork-share';
import { assertFieldworkLinkPageAccess } from '@/server/page-fieldwork-link-access';
import { getQuotaViewForShare } from '@/server/quota/services/quota-status';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '쿼터 현황',
};

interface PageProps {
  params: Promise<{ token: string }>;
}

/**
 * 외주가 보는 쿼터 현황 — **읽기 전용 현황판 하나**다 (ADR-0026 이후 추가, 2026-10-12).
 *
 * 전화를 돌리는 사람이 어느 셀이 찼는지 모르면 이미 마감된 조건의 대상에게 계속 연락한다.
 * 그래서 현황판만 연다. 내부 콘솔의 쿼터 화면(`/surveys/<id>/operations/quota`)은 플랜 편집을
 * 함께 그리고 그 저장은 `survey.edit` 축이라 링크에게 없다 — 여기는 그 화면이 아니다.
 *
 * **나눈 링크의 숫자는 연구원·클라이언트와 다르다**(fieldwork-multi-company 티켓 08, PRD 스토리 40·41). 셀마다
 * 내 달성 수(지금 담당 범위 대상의 완료)와 셀 마감 여부(설문 전체 기준)만 싣고, 전체 목표·전체 달성
 * 수는 RSC payload 에도 없다 — 업체가 여럿이면 남의 몫을 짐작할 재료가 되기 때문이다. **한 번도 나누지 않은
 * 링크는 지금처럼 전체 현황이다**(스토리 22). 갈래는 응답 현황의 쿼터 조각과 같은 `getQuotaViewForShare`
 * 하나가 정한다. 빈 상태 문구는 클라이언트 콘솔(`app/_client-console/quota-screen`)과 같게 둔다.
 *
 * 묻는 capability 는 응답 현황과 같은 `operations.view` 다 — 개인정보가 없는 집계라 조사 대상
 * 축(`contacts.view`)이 아니다. 새 capability 를 세우지 않았다: 링크의 여섯 칸은 그대로다.
 */
export default async function FieldworkLinkQuotaPage({ params }: PageProps) {
  const { token } = await params;
  const { actor, surveyId } = await assertFieldworkLinkPageAccess(token, 'operations.view');
  const view = await getQuotaViewForShare(
    surveyId,
    EXTERNAL_VIEWER_DATA_SCOPE,
    resolveFieldworkShare(actor, surveyId),
  );

  return (
    <main className="mx-auto max-w-7xl space-y-4 px-6 py-8">
      <div>
        <h2 className="text-xl font-bold text-gray-900">쿼터 현황</h2>
        <p className="text-sm text-slate-500">
          {view?.kind === 'share' ? '맡은 조사 대상의 완료 수와 셀 마감 여부' : '목표 대비 완료 응답 집계'}
        </p>
      </div>
      {view && view.status.cells.length > 0 ? (
        view.kind === 'share' ? (
          <ShareQuotaStatusPanel status={view.status} />
        ) : (
          <QuotaStatusPanel status={view.status} isTestScope={false} />
        )
      ) : (
        <GuestEmptyState
          title="설정된 쿼터가 없습니다."
          description="담당 연구원이 쿼터를 설정하면 달성 현황이 여기에 표시됩니다."
        />
      )}
    </main>
  );
}
