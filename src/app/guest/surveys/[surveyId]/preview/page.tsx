import { Eye } from 'lucide-react';

import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';
import { assertGuestSurveyPageAccess } from '@/server/page-guest-access';
import { getSurveyForResponse } from '@/server/survey-builder/services/survey-read';

interface Props {
  params: Promise<{ surveyId: string }>;
}

export const dynamic = 'force-dynamic';

export const metadata = { title: '설문 미리보기' };

/**
 * 설문지 미리보기 (.pen FLOW 5-3 탭 1, 스펙 §5 「보는 것 ①」).
 *
 * 관문에 탭을 넘기지 않는다 — 미리보기는 화이트리스트 밖이라 부여된 설문이면 언제나 열린다.
 *
 * 관리자 「설문 보기」와 **같은 열람 전용 모드**(`SurveyResponseFlow mode="preview"`)를 쓴다.
 * 그 모드는 배포 스냅샷을 그리되 저장 경로가 없어 응답이 남지 않는다 — 게스트용 렌더러를
 * 따로 만들면 「미리보기에서는 되는데 실제로는 다른」 화면이 두 벌 생긴다.
 */
export default async function GuestSurveyPreviewPage({ params }: Props) {
  const { surveyId } = await params;
  await assertGuestSurveyPageAccess(surveyId);

  const preview = await getSurveyForResponse({ surveyId }, { requirePublished: true });
  if (!preview) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <div className="rounded-[14px] border border-[#E5E5EA] bg-white p-8">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-[10px] bg-[#EEF2FF]">
            <Eye className="h-6 w-6 text-[#2E4FCE]" />
          </span>
          <h2 className="text-[16px] font-semibold text-[#1C1C1E]">아직 배포된 설문이 없습니다</h2>
          <p className="mt-2 text-[13px] text-[#6E6E73]">
            담당 연구원이 설문을 배포하면 응답 화면을 그대로 볼 수 있습니다.
          </p>
        </div>
      </main>
    );
  }

  return (
    <SurveyResponseFlow
      mode="preview"
      surveyIdentifier={surveyId}
      previewContext={{ survey: preview.survey, versionId: preview.versionId }}
    />
  );
}
