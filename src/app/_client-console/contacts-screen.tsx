import { GuestContactsTable } from '@/features/guest-console/guest-contacts-table';
import { listGuestContacts } from '@/server/read-models/guest-contacts';

interface Props {
  surveyId: string;
  /** 이 화면 자신의 주소 — 페이지 이동 링크가 여기에 `?page=` 만 덧붙인다. */
  basePath: string;
  searchParams: { page?: string };
}

/**
 * 클라이언트 콘솔의 조사 대상 본문 — **두 입구가 함께 쓴다** (ADR-0029).
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
 * **마스킹본** (.pen FLOW 5-2 칩, 스펙 §5 「조사 대상 — 마스킹본(연락처 원본 없음)」).
 *
 * 투영은 서버가 끝낸다(`listGuestContacts`) — 화면에 도착하는 행에는 표시 문자열밖에 없고
 * 컨택 id 도 초대 토큰도 실려 있지 않다. 「무엇을 안 그리는가」가 아니라 「무엇이 오지
 * 않는가」가 이 탭의 계약이다.
 */
export async function ClientContactsScreen({ surveyId, basePath, searchParams }: Props) {
  const { page: pageStr } = searchParams;
  const pageRaw = Number(pageStr);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;

  const contacts = await listGuestContacts(surveyId, page);

  return (
    <main className="mx-auto max-w-7xl space-y-4 px-6 py-8">
      <div>
        <h2 className="text-xl font-bold text-gray-900">조사 대상</h2>
        <p className="text-sm text-slate-500">
          연락처 등 개인정보는 일부만 표시됩니다.
        </p>
      </div>
      <GuestContactsTable page={contacts} basePath={basePath} />
    </main>
  );
}
