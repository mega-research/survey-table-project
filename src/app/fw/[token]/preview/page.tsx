import Link from 'next/link';

import { ArrowLeft, Eye } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { fieldworkLinkOperationsBase } from '@/features/operations/operations-paths';
import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';
import { assertFieldworkLinkPageAccess } from '@/server/page-fieldwork-link-access';
import { getSurveyForResponse } from '@/server/survey-builder/services/survey-read';

interface PageProps {
  params: Promise<{ token: string }>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '설문 보기' };

/**
 * 외주가 보는 「설문 보기」 — 내부 콘솔의 `/surveys/<id>/preview` 와 **같은 열람 전용 모드**다.
 *
 * `SurveyResponseFlow mode="preview"` 는 배포 스냅샷을 그리되 저장 경로가 없어 응답이 남지 않는다.
 * 외주용 렌더러를 따로 만들면 「미리보기에서는 되는데 실제로는 다른」 화면이 두 벌 생긴다
 * (게스트 미리보기와 같은 이유).
 *
 * 내부 화면에서 두 가지를 뺀다.
 *  - **미리보기 링크 복사** — `previewToken` 주소는 계정도 링크 세션도 묻지 않는 pub 경로라, 외주
 *    링크를 종료하거나 비밀번호를 바꿔도 계속 열린다. 링크가 닫히면 외주의 열람도 닫혀야 한다.
 *  - **설문 편집** — 링크 열에 `survey.edit` 이 없다.
 *
 * 관문은 `survey.view` 다. 중단 중이면 링크 자체가 닫혀 입구 화면으로 돌아간다(ADR-0026).
 */
export default async function FieldworkLinkPreviewPage({ params }: PageProps) {
  const { token } = await params;
  const { surveyId } = await assertFieldworkLinkPageAccess(token, 'survey.view');
  const preview = await getSurveyForResponse({ surveyId }, { requirePublished: true });
  const backHref = fieldworkLinkOperationsBase(token);

  const backButton = (
    <Button variant="outline" size="sm" asChild>
      <Link href={backHref}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        현황으로
      </Link>
    </Button>
  );

  if (!preview) {
    return (
      <main className="min-h-screen bg-gray-50">
        <nav className="border-b border-gray-200 bg-white px-6 py-4">
          <div className="mx-auto flex max-w-4xl items-center">{backButton}</div>
        </nav>
        <section className="mx-auto max-w-4xl px-6 py-16">
          <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50">
              <Eye className="h-6 w-6 text-blue-500" />
            </div>
            <h1 className="text-xl font-semibold text-gray-900">배포된 설문이 없습니다</h1>
            <p className="mt-2 text-sm text-gray-500">
              담당 연구원이 설문을 배포하면 응답 화면을 그대로 볼 수 있습니다.
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
          <div className="flex shrink-0 items-center gap-2">{backButton}</div>
        </div>
      </div>
      <SurveyResponseFlow
        mode="preview"
        surveyIdentifier={surveyId}
        previewContext={{
          survey: preview.survey,
          versionId: preview.versionId,
          documentView: preview.documentView,
        }}
      />
    </>
  );
}
