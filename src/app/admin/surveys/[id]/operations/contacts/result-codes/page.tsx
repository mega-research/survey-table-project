import type { Metadata } from 'next';

import { ResultCodesEditor } from '@/features/operations/contacts/result-codes-editor';
import { getContactResultCodes } from '@/server/read-models/contacts';
import { requireAdminPage } from '@/lib/auth/require-admin-page';

export const metadata: Metadata = {
  title: '현황 - 결과코드 설정',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ContactResultCodesPage({ params }: PageProps) {
  // 게스트 차단 화면 — admin 레이아웃의 경로 가드는 소프트 내비게이션에서 재실행되지 않으므로
  // 페이지가 스스로 막는다(페이지는 내비게이션마다 반드시 다시 렌더된다).
  await requireAdminPage();
  const { id: surveyId } = await params;
  const codes = await getContactResultCodes(surveyId);

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">결과코드 설정</h2>
        <p className="text-sm text-slate-600">회차의 결과코드 라디오를 사용자 정의합니다.</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-500">
          <li>긍정: 응답 완료로 인정 (응답률 분자)</li>
          <li>중립: 응답률 분모에만 포함</li>
          <li>부정: 모집단에서 완전 제외 — 응답률·단체메일·응답 페이지 모두에서 제거</li>
        </ul>
      </div>
      <ResultCodesEditor surveyId={surveyId} initialCodes={codes} />
    </main>
  );
}
