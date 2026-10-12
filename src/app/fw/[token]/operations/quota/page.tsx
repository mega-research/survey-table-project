import type { Metadata } from 'next';

import { ClientQuotaScreen } from '@/app/_client-console/quota-screen';
import { assertFieldworkLinkPageAccess } from '@/server/page-fieldwork-link-access';

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
 * 본문은 클라이언트 콘솔과 같은 것을 쓴다(`app/_client-console/quota-screen`). 쿼터는 목표 대비
 * 달성 집계라 연구원·고객사·외주가 같은 숫자를 봐야 하고, 그 본문은 세션을 읽지 않으며
 * 파티션이 실데이터 상수라 링크 세션에서도 그대로 돈다(외부 주체는 언제나 실데이터를 본다).
 *
 * 묻는 capability 는 응답 현황과 같은 `operations.view` 다 — 개인정보가 없는 집계라 조사 대상
 * 축(`contacts.view`)이 아니다. 새 capability 를 세우지 않았다: 링크의 여섯 칸은 그대로다.
 */
export default async function FieldworkLinkQuotaPage({ params }: PageProps) {
  const { token } = await params;
  const { surveyId } = await assertFieldworkLinkPageAccess(token, 'operations.view');

  return <ClientQuotaScreen surveyId={surveyId} />;
}
