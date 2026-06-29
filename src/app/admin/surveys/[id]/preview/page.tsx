import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft, Eye, Pencil } from 'lucide-react';

import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';
import { Button } from '@/components/ui/button';
import {
  getSurveyById,
  getSurveyForResponse,
} from '@/features/survey-builder/server/services/survey-read.service';

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '설문 보기' };

export default async function SurveyPreviewPage({ params }: PageProps) {
  const { id: surveyId } = await params;
  const survey = await getSurveyById(surveyId);
  if (!survey || survey.deletedAt) notFound();

  const preview = await getSurveyForResponse(
    { surveyId },
    { requirePublished: true },
  );

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
            <Button variant="outline" size="sm" asChild>
              <Link href={`/admin/surveys/${surveyId}/edit`}>
                <Pencil className="mr-2 h-4 w-4" />
                설문 편집
              </Link>
            </Button>
          </div>
        </nav>

        <section className="mx-auto max-w-4xl px-6 py-16">
          <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50">
              <Eye className="h-6 w-6 text-blue-500" />
            </div>
            <h1 className="text-xl font-semibold text-gray-900">
              배포된 설문이 없습니다
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              설문을 배포한 뒤 응답 화면을 확인할 수 있습니다.
            </p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <>
      <div className="border-b border-blue-200 bg-blue-50 px-6 py-3">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2 text-sm text-blue-900">
            <Eye className="h-4 w-4 shrink-0" />
            <span className="truncate">
              설문 보기 모드 — 배포된 응답 화면이며 입력 내용은 저장되지 않습니다.
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/admin/surveys/${surveyId}/operations/overview`}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                현황으로
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/admin/surveys/${surveyId}/edit`}>
                <Pencil className="mr-2 h-4 w-4" />
                설문 편집
              </Link>
            </Button>
          </div>
        </div>
      </div>
      <SurveyResponseFlow
        mode="preview"
        surveyIdentifier={surveyId}
        previewContext={{
          survey: preview.survey,
          versionId: preview.versionId,
        }}
      />
    </>
  );
}
