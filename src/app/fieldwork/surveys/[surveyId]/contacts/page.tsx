import { FieldworkContactsTable } from '@/features/fieldwork-console/fieldwork-contacts-table';
import { assertFieldworkSurveyPageAccess } from '@/server/page-fieldwork-access';
import { listFieldworkContacts } from '@/server/read-models/fieldwork-contacts';

interface Props {
  params: Promise<{ surveyId: string }>;
  searchParams: Promise<{ page?: string; q?: string; group?: string; result?: string }>;
}

/**
 * 실사 조사 대상 (.pen FLOW 10-2, 역할 모델 v2 티켓 26).
 *
 * 관문이 **초대와 파생 시야를 함께** 통과시키고, 갈리는 것은 `canWriteAttempts` 하나다 —
 * 팀장이 소속원 설문을 열면 표는 그대로 보이되 「결과 기록」 버튼이 없다(스펙 §6 「본인
 * 초대 시」). 강제는 쓰기 표면의 관문이 하고 이 값은 화면이 거짓 버튼을 안 만드는 용도다.
 *
 * 필터는 주소에서 읽어 서버가 좁힌다 — 클라이언트가 전량을 받아 거르면 원본 연락처가
 * 필요 이상으로 브라우저에 실린다.
 */
export default async function FieldworkContactsPage({ params, searchParams }: Props) {
  const { surveyId } = await params;
  const { canWriteAttempts } = await assertFieldworkSurveyPageAccess(surveyId, 'contacts.view');

  const sp = await searchParams;
  const filters = {
    q: sp.q?.trim() ?? '',
    group: sp.group ?? '',
    result: sp.result ?? '',
  };

  const page = await listFieldworkContacts({
    surveyId,
    page: Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1),
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.group ? { groupValue: filters.group } : {}),
    ...(filters.result ? { resultCode: filters.result } : {}),
    // 대행 링크는 **본인이 초대된 실사에게만** 실린다 — 팀장의 파생 시야에서는 투영이
    // 토큰을 빼므로 화면이 버튼을 그릴 수 없다(ADR-0019). 버튼만 감추는 것으로는 부족한
    // 이유는 `/survey/[id]?invite=` 가 pub 경로라 서버가 다시 막지 못하기 때문이다.
    canProxyRespond: canWriteAttempts,
  });

  return (
    <main className="mx-auto max-w-[1100px] px-6 py-8">
      <div className="mb-4 space-y-1">
        <h2 className="text-[18px] font-semibold text-[#1C1C1E]">조사 대상</h2>
        <p className="text-[12.5px] text-[#6E6E73]">
          연락처 원본을 확인하고 결과코드·메모를 기록합니다. 명단 수정·업로드·메일은 담당
          연구원 몫입니다.
        </p>
      </div>

      <FieldworkContactsTable
        surveyId={surveyId}
        page={page}
        filters={filters}
        canWriteAttempts={canWriteAttempts}
      />
    </main>
  );
}
