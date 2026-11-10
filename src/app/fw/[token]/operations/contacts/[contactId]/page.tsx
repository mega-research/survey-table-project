import type { Metadata } from 'next';

import { fieldworkLinkOperationsBase } from '@/features/operations/operations-paths';
import { getOperationsDataScope } from '@/server/data-scope';
import { resolveFieldworkShare } from '@/server/fieldwork-share-scope';
import { assertFieldworkLinkPageAccess } from '@/server/page-fieldwork-link-access';

import { ContactDetailScreen } from '@/app/_operations/contact-detail-screen';

export const metadata: Metadata = {
  title: '조사 대상 상세',
};

interface PageProps {
  params: Promise<{ token: string; contactId: string }>;
}

/**
 * 외주가 보는 조사 대상 단건 — 내부 콘솔과 **같은 본문**이다 (ADR-0026, 티켓 08).
 *
 * 여기가 외주 업무의 중심이다: 연락처를 평문으로 확인해 전화를 걸고(스토리 29), 통화 결과를
 * 회차로 쌓고(30), 맥락을 메모로 남긴다(31). 회차 저장과 메모 저장이 **다른 버튼**이라 메모만
 * 고치려다 회차가 쌓이지 않는다(32).
 *
 * 빠지는 것은 전부 판정이 정한다 — 명단 수정 폼·삭제(`contacts.manage`), 응답 초기화·재응답
 * 허용(`responses.manage`). 링크 열에 그 칸이 없어 화면에 그려지지 않고, 서버도 각자의
 * 관문으로 거부한다. 응답 수정·편집 이력(`responses.view`)과 단건 메일·그 사람의 발송 이력
 * (`mail.sendSingle`)은 ADR-0027 이 열었다 — 편집 이력의 연구원 이메일은 걷어서 넘긴다.
 *
 * **대행 진입점은 열린다.** 링크는 그 설문의 대리 응답 자격을 갖는 주체이고(ADR-0026),
 * 초대 코드의 노출은 화면이 아니라 이 인자가 정한다 — 귀속과 완료 대상 거부는 티켓 09 다.
 *
 * **담당 범위 밖 대상은 없는 대상과 같은 notFound 다** (fieldwork-multi-company 티켓 05) — 범위는 조회
 * 조건이라 PII 를 복호화하기 전에 접힌다. 범위 안 대상의 대행 진입도 응답 procedure 가 같은 범위로 다시
 * 묻는다(`server/fieldwork-proxy`) — 초대 코드가 이 화면 밖에서 새어도 범위 밖이면 대행이 서지 않는다.
 */
export default async function FieldworkLinkContactDetailPage({ params }: PageProps) {
  const { token, contactId } = await params;
  const { actor, surveyId, capabilities } = await assertFieldworkLinkPageAccess(
    token,
    'contacts.view',
  );
  const scope = await getOperationsDataScope(surveyId, actor);
  const share = resolveFieldworkShare(actor, surveyId);

  return (
    <ContactDetailScreen
      surveyId={surveyId}
      contactId={contactId}
      basePath={fieldworkLinkOperationsBase(token)}
      capabilities={capabilities}
      scope={scope}
      share={share}
      canProxyRespond
      hideStaffEmails
    />
  );
}
