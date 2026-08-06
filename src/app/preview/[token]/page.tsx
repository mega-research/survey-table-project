import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Eye } from 'lucide-react';

import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';
import {
  getSurveyById,
  getSurveyByPrivateToken,
  getSurveyForResponse,
} from '@/features/survey-builder/server/services/survey-read.service';

interface PageProps {
  params: Promise<{ token: string }>;
}

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '설문 보기',
  robots: { index: false, follow: false },
};

/**
 * 로그인 없이 접근 가능한 공개 읽기 전용 설문 미리보기.
 *
 * `/admin/surveys/[id]/preview` 는 middleware 보호 + 내부 UUID(id) 노출이라 그대로
 * 공유할 수 없다. 이 라우트는 `surveys.privateToken`(설문마다 발급되는 unguessable
 * 공개 핸들, `/survey/[id]` 접근과 동일 개념)만으로 설문을 찾는다 — id/slug 로는
 * 절대 매칭하지 않는다(getSurveyByPrivateToken 은 privateToken 컬럼만 조회).
 *
 * mode="preview" 라 응답을 저장하지 않으므로 인증 없이 노출해도 안전하다.
 */
export default async function PublicSurveyPreviewPage({ params }: PageProps) {
  const { token } = await params;

  const idRow = await getSurveyByPrivateToken({ token });
  if (!idRow) notFound();

  const survey = await getSurveyById(idRow.id);
  if (!survey || survey.deletedAt) notFound();

  const preview = await getSurveyForResponse(
    { surveyId: survey.id },
    { requirePublished: true },
  );

  if (!preview) {
    return (
      <main className="min-h-screen bg-gray-50">
        <section className="mx-auto max-w-4xl px-6 py-16">
          <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50">
              <Eye className="h-6 w-6 text-blue-500" />
            </div>
            <h1 className="text-xl font-semibold text-gray-900">배포된 설문이 없습니다</h1>
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
        <div className="mx-auto flex max-w-7xl items-center gap-2 text-sm text-blue-900">
          <Eye className="h-4 w-4 shrink-0" />
          <span className="truncate">
            설문 보기 모드 — 배포된 응답 화면이며 입력 내용은 저장되지 않습니다.
          </span>
        </div>
      </div>
      {/*
        surveyIdentifier 는 내부 UUID(survey.id) 대신 privateToken 을 넘긴다.
        preview 모드는 use-survey-loader 의 isPreview 분기에서 previewContext 로
        즉시 렌더하고 리턴하므로(parsesurveyIdentifier 재호출 없음) identifier 값은
        재사용되지 않는다 — id 를 노출할 이유가 없다.
      */}
      <SurveyResponseFlow
        mode="preview"
        surveyIdentifier={token}
        previewContext={{
          survey: preview.survey,
          versionId: preview.versionId,
        }}
      />
    </>
  );
}
