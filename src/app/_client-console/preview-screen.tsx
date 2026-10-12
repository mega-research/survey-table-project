import { Eye } from 'lucide-react';

import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';
import { getSurveyForResponse } from '@/server/survey-builder/services/survey-read';

/**
 * 클라이언트 콘솔의 설문지 미리보기 본문 — **두 입구가 함께 쓴다** (ADR-0029).
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
 * .pen FLOW 5-3 탭 1, 스펙 §5 「보는 것 ①」. 화이트리스트 밖이라 열어 준 설문이면 언제나 열린다 —
 * 그래서 page 가 관문에 탭을 넘기지 않는다.
 *
 * 관리자 「설문 보기」와 **같은 열람 전용 모드**(`SurveyResponseFlow mode="preview"`)를 쓴다.
 * 그 모드는 배포 스냅샷을 그리되 저장 경로가 없어 응답이 남지 않는다 — 게스트용 렌더러를
 * 따로 만들면 「미리보기에서는 되는데 실제로는 다른」 화면이 두 벌 생긴다.
 *
 * 조사표(PDF 분할 화면)를 함께 넘긴다 — 빠뜨리면 조사표가 붙은 설문이 분할 없이 그려져
 * 응답자가 보는 화면과 다른 모양이 된다(내부·외주 링크의 미리보기와 맞춘다).
 */
export async function ClientPreviewScreen({ surveyId }: { surveyId: string }) {
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
      previewContext={{
        survey: preview.survey,
        versionId: preview.versionId,
        documentView: preview.documentView,
      }}
    />
  );
}
