import { notFound } from 'next/navigation';

import { ClientResponsesTable } from '@/features/guest-console/client-responses-table';
import {
  ClientLinkGoneError,
  listClientResponses,
} from '@/server/operations/services/client-responses';

export interface ClientResponsesSearchParams {
  page?: string;
  status?: string;
}

interface Props {
  surveyId: string;
  /** 이 화면 자신의 주소 — 좁히기·페이지 링크가 여기에 쿼리를 붙인다. */
  basePath: string;
  searchParams: ClientResponsesSearchParams;
  /** 관문이 승인한 링크 — 열 설정과 조회 키를 이 링크로 묶는다. */
  linkId: string;
  /** 「응답 조회」 칩 — 켜면 행마다 「조회」(`<basePath>/<조회 키>`)가 선다. 끄면 조회 키를 싣지 않는다. */
  responseView: boolean;
  /** 「엑셀 다운로드」 칩이 열렸을 때의 내려받기 주소(상태 좁히기를 이 화면이 붙인다). 닫혔으면 없다. */
  exportHref?: string;
}

/**
 * 클라이언트 링크의 응답 내역 본문 (`.scratch/client-link-response-list` 티켓 03).
 *
 * 이 폴더의 다른 본문과 달리 **입구가 하나**다 — 게스트 계정 콘솔에는 응답 내역 칩이 없다. 그래도
 * 여기 두는 것은 클라이언트가 보는 본문이 한 폴더에 모여 있어야 「무엇이 밖으로 나가는가」를 한
 * 자리에서 읽을 수 있어서다.
 *
 * **세션을 읽지 않는다.** 받는 것은 설문 id 와 주소 접두뿐이고 파티션은 투영이 실데이터로 고정한다.
 * 주소의 쿼리는 `page`·`status` 둘만 넘긴다 — 정렬 값을 받지 않는 것이 투영의 계약이다.
 */
export async function ClientResponsesScreen({
  surveyId,
  basePath,
  searchParams,
  linkId,
  responseView,
  exportHref,
}: Props) {
  const page = await listClientResponses(
    surveyId,
    {
      ...(typeof searchParams.page === 'string' ? { page: searchParams.page } : {}),
      ...(typeof searchParams.status === 'string' ? { status: searchParams.status } : {}),
    },
    { linkId, viewKeys: responseView },
  ).catch((error: unknown) => {
    // 관문을 지난 뒤 링크가 닫혔다 — 다른 링크의 설정으로 그리지 않는다.
    if (error instanceof ClientLinkGoneError) notFound();
    throw error;
  });
  // 내려받기는 지금 고른 상태 좁히기를 싣는다 — 화면에서 본 목록 그대로가 파일이 된다.
  const download =
    exportHref === undefined
      ? undefined
      : page.status === 'all'
        ? exportHref
        : `${exportHref}?status=${encodeURIComponent(page.status)}`;

  return (
    <main className="mx-auto max-w-7xl space-y-4 px-6 py-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">응답 내역</h2>
          <p className="text-sm text-slate-500">
            응답자별 진행 상태 — {page.total.toLocaleString('ko-KR')}건
          </p>
        </div>
        {download !== undefined && (
          // 파일 응답이라 클라이언트 라우터가 가로채지 않게 일반 링크로 둔다(Next Link 가 아니다).
          <a
            href={download}
            download
            className="flex h-[32px] shrink-0 items-center rounded-[8px] border border-[#E5E5EA] bg-white px-3 text-[12.5px] font-medium text-[#374151] hover:bg-[#F5F5F7]"
          >
            엑셀 다운로드
          </a>
        )}
      </div>
      <ClientResponsesTable page={page} basePath={basePath} />
    </main>
  );
}
