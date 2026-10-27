import { ClientResponsesTable } from '@/features/guest-console/client-responses-table';
import { listClientResponses } from '@/server/operations/services/client-responses';

export interface ClientResponsesSearchParams {
  page?: string;
  status?: string;
}

interface Props {
  surveyId: string;
  /** 이 화면 자신의 주소 — 좁히기·페이지 링크가 여기에 쿼리를 붙인다. */
  basePath: string;
  searchParams: ClientResponsesSearchParams;
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
export async function ClientResponsesScreen({ surveyId, basePath, searchParams }: Props) {
  const page = await listClientResponses(surveyId, {
    ...(typeof searchParams.page === 'string' ? { page: searchParams.page } : {}),
    ...(typeof searchParams.status === 'string' ? { status: searchParams.status } : {}),
  });

  return (
    <main className="mx-auto max-w-7xl space-y-4 px-6 py-8">
      <div>
        <h2 className="text-xl font-bold text-gray-900">응답 내역</h2>
        <p className="text-sm text-slate-500">
          응답자별 진행 상태 — {page.total.toLocaleString('ko-KR')}건
        </p>
      </div>
      <ClientResponsesTable page={page} basePath={basePath} />
    </main>
  );
}
