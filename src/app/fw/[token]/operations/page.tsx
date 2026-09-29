import { redirect } from 'next/navigation';

import { fieldworkLinkOperationsPaths } from '@/features/operations/operations-paths';
import { assertFieldworkLinkPageAccess } from '@/server/page-fieldwork-link-access';

/**
 * 탭 없는 주소 — 조사 대상으로 보낸다 (게스트·실사 콘솔과 같은 관례).
 *
 * 없으면 404 다. 이 주소는 화면이 만들지 않지만 사람은 만든다(주소창 편집·링크 잘라 붙이기).
 *
 * 읽는 것이 없는데도 관문을 부른다. 「모든 콘솔 페이지가 자기 관문을 진다」를 예외 없이
 * 두는 것이 첫 이유이고(형제 게스트 index 와 같다), 실용적인 이유가 하나 더 있다 —
 * 링크가 닫힌 상태에서 여기로 들어오면 관문이 입구 화면으로 보내 준다. 관문이 없으면
 * 조사 대상으로 보냈다가 거기서 다시 튕겨 나와 주소가 두 번 바뀐다.
 */
interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function FieldworkLinkOperationsIndex({ params }: PageProps) {
  const { token } = await params;
  await assertFieldworkLinkPageAccess(token, 'contacts.view');
  redirect(fieldworkLinkOperationsPaths(token).contacts);
}
