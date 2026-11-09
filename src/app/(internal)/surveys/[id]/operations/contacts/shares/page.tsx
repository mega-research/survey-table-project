import type { Metadata } from 'next';

import { ShareList } from '@/features/operations/contacts/shares/share-list';
import { requireAdminPage } from '@/lib/auth/require-admin-page';
import { listFieldworkShares } from '@/server/contacts/services/fieldwork-shares';
import { assertSurveyCapabilityPage } from '@/server/page-survey-access';

export const metadata: Metadata = {
  title: '현황 - 외주 담당 범위',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * 외주 담당 범위 (ADR-0035, fieldwork-multi-company 티켓 03) — 이 설문의 외주 링크마다 볼 수 있는 조사 대상.
 *
 * 링크를 발급하는 사람의 화면이다 — 관문이 `survey.manageAccess` 라 컨택원을 나눌 수 있는 사내 실사원
 * (전체 권한 참여자)에게도 열리지 않는다. 상위 레이아웃은 소프트 내비게이션에서 다시 돌지 않으므로
 * 페이지가 스스로 막는다. 범위는 실데이터에만 선다(브라우저의 테스트 보기와 무관).
 */
export default async function FieldworkSharesPage({ params }: PageProps) {
  const { id: surveyId } = await params;
  const viewer = await requireAdminPage();
  await assertSurveyCapabilityPage(viewer, surveyId, 'survey.manageAccess');
  const { links } = await listFieldworkShares(surveyId);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">외주 담당 범위</h2>
        <p className="text-sm text-slate-500">
          외주 업체마다 볼 수 있는 조사 대상을 정합니다. 나누지 않은 링크는 설문 전체를 봅니다 —
          업체가 둘 이상이면 링크를 건네기 전에 나눠 주세요. 컨택원 배정과는 따로입니다.
        </p>
      </div>
      <ShareList surveyId={surveyId} links={links} />
    </main>
  );
}
