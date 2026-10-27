import { assertClientLinkPageAccess } from '@/server/page-client-link-access';

interface Props {
  params: Promise<{ token: string }>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '현황 열람' };

/**
 * 「열린 화면이 없습니다」 — 칩을 전부 끈 클라이언트 링크의 착지점
 * (`clientConsoleEntryHref`, 세그먼트는 `CLIENT_EMPTY_SEGMENT`).
 *
 * 설문 보기가 칩이 된 뒤로 갈 곳이 하나도 없는 링크가 생길 수 있다. 미리보기로 보내면 404 이고
 * 클라이언트는 「링크가 죽었다」로 읽는다 — 셸(조사 이름·나가기) 안에서 사실을 말한다.
 *
 * 관문은 탭 없이 지난다 — 링크가 열려 있는가까지만 묻는다. 칩이 켜진 링크로 이 주소를 직접
 * 열어도 같은 문구가 보일 뿐이고, 무엇이 켜졌는지는 드러나지 않는다(탭 줄은 원래 보인다).
 */
export default async function ClientLinkEmptyPage({ params }: Props) {
  const { token } = await params;
  await assertClientLinkPageAccess(token);

  return (
    <main className="mx-auto max-w-7xl px-6 py-16 text-center">
      <p className="text-base font-semibold text-gray-900">열린 화면이 없습니다</p>
      <p className="mt-1.5 text-sm text-slate-500">담당 연구원에게 문의해 주세요.</p>
    </main>
  );
}
