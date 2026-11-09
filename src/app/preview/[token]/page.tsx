import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Eye } from 'lucide-react';

import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';
import { TooManyRequestsScreen } from '@/features/survey-response/survey-response-screens';
import { getCurrentUser } from '@/lib/auth';
import { isRscRateLimited } from '@/lib/rate-limit/rsc-guard';
import { loadPreviewContactSeed } from '@/server/contacts/services/preview-contact';
import { loadOperationsDataScope } from '@/server/data-scope';
import {
  getSurveyById,
  getSurveyByPreviewToken,
  getSurveyForResponse,
} from '@/server/survey-builder/services/survey-read';
import { isActiveUser } from '@/shared/contracts/auth';

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
 * `/surveys/[id]/preview` 는 middleware 보호 + 내부 UUID(id) 노출이라 그대로
 * 공유할 수 없다. 이 라우트는 `surveys.previewToken`(설문마다 발급되는 unguessable
 * 공개 핸들, 미리보기 전용)만으로 설문을 찾는다 — id/slug/privateToken 으로는
 * 절대 매칭하지 않는다(getSurveyByPreviewToken 은 previewToken 컬럼만 조회).
 *
 * privateToken 은 `/survey/[id]` 응답(답변 제출) 경로의 크레덴셜을 겸한다 — 이 라우트가
 * privateToken 을 받아들이면 "미리보기 링크 공유"가 곧 "응답 제출 권한 공유"가 되어버린다
 * (URL 을 /survey/<token> 으로 바꾸기만 하면 실제 응답이 들어감). previewToken 은 답변
 * 크레덴셜로 전혀 사용되지 않는 별도 컬럼이라 이 문제가 없다.
 *
 * mode="preview" 라 응답을 저장하지 않으므로 인증 없이 노출해도 안전하다.
 *
 * 관리자 「설문 보기」처럼 첫 번째 조사 대상(resid 최소)의 명단 값·이월 응답으로 연다(2026-11-04 사용자 결정 —
 * 링크를 받은 사람이 그 대상의 명단 값을 보게 되는 것을 알고 골랐다). 개인정보 열은 배포본이 토큰·조건으로
 * 읽는 열만 싣는다(`collectReferencedContactKeys`). 파티션은 콘솔과 같은 판정이라 로그인 없는 방문자는 실데이터다.
 */
export default async function PublicSurveyPreviewPage({ params }: PageProps) {
  // /i/<code> 와 같은 이유 — 공개 RSC 라 procedure 를 지나지 않아 조회가 계측 밖이다.
  // previewToken 은 unguessable 이지만 유효 토큰 하나로 무제한 반복이 가능하다.
  if (await isRscRateLimited('public-read')) return <TooManyRequestsScreen />;

  const { token } = await params;

  const idRow = await getSurveyByPreviewToken({ token });
  if (!idRow) notFound();

  const survey = await getSurveyById(idRow.id);
  if (!survey || survey.deletedAt) notFound();

  const preview = await getSurveyForResponse({ surveyId: survey.id }, { requirePublished: true });

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

  // 공개 표면이다 — 고객사처럼 로그인하지 않은 방문자가 대부분이다. 테스트 보기는 로그인한 직원의
  // 선택일 뿐이고 그 판정(`loadOperationsDataScope`)은 세션이 없으면 던지므로, 세션이 있는 활성 계정에만
  // 묻는다. 나머지는 실데이터 대상자로 채운다.
  const viewer = await getCurrentUser();
  const isTest =
    viewer !== null &&
    isActiveUser(viewer.status) &&
    (await loadOperationsDataScope(survey.id)) === 'test';
  const seed = await loadPreviewContactSeed({
    surveyId: survey.id,
    isTest,
    structure: preview.survey,
  });

  return (
    <>
      <div className="border-b border-blue-200 bg-blue-50 px-6 py-3">
        <div className="mx-auto flex max-w-7xl items-center gap-2 text-sm text-blue-900">
          <Eye className="h-4 w-4 shrink-0" />
          <span className="truncate">
            설문 보기 모드 — 배포된 응답 화면이며 입력 내용은 저장되지 않습니다.
            {seed
              ? ` 명단 값·이월 값은 ${seed.isTest ? '테스트 ' : ''}조사 대상 #${seed.resid} 기준입니다.`
              : ''}
          </span>
        </div>
      </div>
      {/*
        surveyIdentifier 는 내부 UUID(survey.id) 대신 previewToken(경로의 token)을 넘긴다.
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
          // 두 미리보기 경로 모두 발행 스냅샷을 읽으므로 앵커도 발행 시점 좌표로 온다
          documentView: preview.documentView,
          ...(seed ? { contactAttrs: seed.contactAttrs, priorAnswers: seed.priorAnswers } : {}),
        }}
      />
    </>
  );
}
