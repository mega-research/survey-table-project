import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft, Eye, Pencil } from 'lucide-react';

import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';
import { Button } from '@/components/ui/button';
import {
  getSurveyById,
  getSurveyForResponse,
} from '@/server/survey-builder/services/survey-read';
import { isGuestViewer } from '@/lib/auth/guest-viewer';
import { loadPreviewContactSeed } from '@/server/contacts/services/preview-contact';
import { loadOperationsDataScope } from '@/server/data-scope';

import { CopyPreviewLinkButton } from './copy-preview-link-button';

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '설문 보기' };

export default async function SurveyPreviewPage({ params }: PageProps) {
  const { id: surveyId } = await params;
  const survey = await getSurveyById(surveyId);
  if (!survey || survey.deletedAt) notFound();

  const [preview, isGuest] = await Promise.all([
    // 저장본(테스트 버전)을 본다 — 고친 것을 배포 없이 확인하는 자리. 공개 미리보기는 배포본이다.
    getSurveyForResponse({ surveyId }, { useTestVersion: true }),
    isGuestViewer(),
  ]);

  if (!preview) {
    return (
      <main className="min-h-screen bg-gray-50">
        <nav className="border-b border-gray-200 bg-white px-6 py-4">
          <div className="mx-auto flex max-w-4xl items-center justify-between">
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/admin/surveys/${surveyId}/operations/overview`}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                현황으로
              </Link>
            </Button>
            <div className="flex items-center gap-2">
              {survey.previewToken && (
                <CopyPreviewLinkButton previewToken={survey.previewToken} />
              )}
              {!isGuest && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/admin/surveys/${surveyId}/edit`}>
                    <Pencil className="mr-2 h-4 w-4" />
                    설문 편집
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </nav>

        <section className="mx-auto max-w-4xl px-6 py-16">
          <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50">
              <Eye className="h-6 w-6 text-blue-500" />
            </div>
            <h1 className="text-xl font-semibold text-gray-900">
              설문을 불러오지 못했습니다
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              잠시 뒤 다시 열어 주세요.
            </p>
          </div>
        </section>
      </main>
    );
  }

  // 첫 번째 조사 대상(resid 최소)의 명단 값·이월 응답으로 연다 — 파티션은 콘솔과 같은 기준(테스트 모드 ∧
  // 이 브라우저의 「테스트 데이터 보기」 ∧ 비게스트일 때 테스트). 개인정보 열은 이 설문이 읽는 열만 싣는다.
  const seed = await loadPreviewContactSeed({
    surveyId,
    isTest: (await loadOperationsDataScope(surveyId)) === 'test',
    structure: preview.survey,
  });

  return (
    <>
      <div className="border-b border-blue-200 bg-blue-50 px-6 py-3">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2 text-sm text-blue-900">
            <Eye className="h-4 w-4 shrink-0" />
            <span className="truncate">
              설문 보기 모드 — 저장한 내용 기준 응답 화면이며 입력 내용은 저장되지 않습니다.
              {seed
                ? ` 명단 값·이월 값은 ${seed.isTest ? '테스트 ' : ''}조사 대상 #${seed.resid} 기준입니다.`
                : ''}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/admin/surveys/${surveyId}/operations/overview`}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                현황으로
              </Link>
            </Button>
            {survey.previewToken && <CopyPreviewLinkButton previewToken={survey.previewToken} />}
            {!isGuest && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/admin/surveys/${surveyId}/edit`}>
                  <Pencil className="mr-2 h-4 w-4" />
                  설문 편집
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>
      <SurveyResponseFlow
        mode="preview"
        surveyIdentifier={surveyId}
        previewContext={{
          survey: preview.survey,
          versionId: preview.versionId,
          // 이 화면은 테스트 버전(저장본) 스냅샷을, 공개 미리보기는 발행 스냅샷을 읽는다 — 앵커도 각자의 시점 좌표다
          documentView: preview.documentView,
          ...(seed ? { contactAttrs: seed.contactAttrs, priorAnswers: seed.priorAnswers } : {}),
        }}
      />
    </>
  );
}
