import { GuestContactsTable } from '@/features/guest-console/guest-contacts-table';
import { assertGuestSurveyPageAccess } from '@/server/page-guest-access';
import { listGuestContacts } from '@/server/read-models/guest-contacts';

interface Props {
  params: Promise<{ surveyId: string }>;
  searchParams: Promise<{ page?: string }>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '조사 대상' };

/**
 * 조사 대상 — **마스킹본** (.pen FLOW 5-2 칩, 스펙 §5 「조사 대상 — 마스킹본(연락처 원본 없음)」).
 *
 * 투영은 서버가 끝낸다(`listGuestContacts`) — 화면에 도착하는 행에는 표시 문자열밖에 없고
 * 컨택 id 도 초대 토큰도 실려 있지 않다. 「무엇을 안 그리는가」가 아니라 「무엇이 오지
 * 않는가」가 이 탭의 계약이다.
 */
export default async function GuestContactsPage({ params, searchParams }: Props) {
  const { surveyId } = await params;
  await assertGuestSurveyPageAccess(surveyId, 'contactsMasked');

  const { page: pageStr } = await searchParams;
  const pageRaw = Number(pageStr);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;

  const contacts = await listGuestContacts(surveyId, page);

  return (
    <main className="mx-auto max-w-7xl space-y-4 px-6 py-8">
      <div>
        <h2 className="text-xl font-bold text-gray-900">조사 대상</h2>
        <p className="text-sm text-slate-500">
          연락처 등 개인정보 컬럼은 마스킹되어 표시됩니다.
        </p>
      </div>
      <GuestContactsTable page={contacts} basePath={`/guest/surveys/${surveyId}/contacts`} />
    </main>
  );
}
