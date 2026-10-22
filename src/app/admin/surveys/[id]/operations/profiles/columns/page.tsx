import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { ProfileColumnEditor } from '@/features/operations/profiles/profile-column-editor';
import { getOperationsDataScope } from '@/server/data-scope';
import { getContactColumnScheme } from '@/server/read-models/contacts';
import {
  getProfileAnswerSources,
  getProfileColumnScheme,
  getProfileEntryParamNames,
} from '@/server/read-models/profile-column-scheme';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '현황 - 응답 내역 컬럼 설정',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * 응답 내역 컬럼 설정 페이지 — 진척률 컬럼 설정(report/columns)과 동일 패턴.
 *
 * - server component: profile_columns(현재 스킴)·contact_columns(attrs./pii. 풀)·이어 넘길 값
 *   이름(entry. 풀)·응답값 열 후보(answer.) 병렬 조회.
 * - 실제 편집 인터랙션은 ProfileColumnEditor(client) 가 담당.
 */
export default async function ProfilesColumnsPage({ params }: PageProps) {
  const { id: surveyId } = await params;
  const scope = await getOperationsDataScope(surveyId);

  const [scheme, contactScheme, entryParamNames, answerSources] = await Promise.all([
    getProfileColumnScheme(surveyId),
    getContactColumnScheme(surveyId, scope),
    getProfileEntryParamNames(surveyId),
    getProfileAnswerSources(surveyId),
  ]);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">응답 내역 컬럼 설정</h2>
          <p className="text-sm text-slate-500">응답 내역 표의 컬럼 순서·라벨·표시 여부</p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/admin/surveys/${surveyId}/operations/profiles`}>← 응답 내역으로</Link>
        </Button>
      </div>

      <ProfileColumnEditor
        surveyId={surveyId}
        initialScheme={scheme}
        contactScheme={contactScheme}
        entryParamNames={entryParamNames}
        answerSources={answerSources}
      />
    </main>
  );
}
