'use client';

import { useParams, useSearchParams } from 'next/navigation';

import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';

export default function SurveyResponsePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  // URL 인코딩된 한글 slug를 디코딩 (원본 page.tsx 동작 보존)
  const identifier = decodeURIComponent(params['id'] as string);
  const inviteToken = searchParams?.get('invite') ?? null;
  // ?test=<token> — 운영 콘솔이 발급한 테스트 링크. 유효하면 중단/중복을 우회한다.
  const testToken = searchParams?.get('test') ?? null;
  // 대행 힌트(`?fw=1`)는 **없다** (ADR-0026, 티켓 09). 그 파라미터의 유일한 목적이 대행
  // 배너를 물을지 정하는 것이었는데 대행 표시 자체가 사라졌다 — 외주가 보는 화면은 응답자가
  // 보는 것과 글자 하나 다르지 않다. 귀속은 저장 경계가 쿠키를 보고 찍는다.

  return (
    <SurveyResponseFlow
      surveyIdentifier={identifier}
      inviteToken={inviteToken}
      testToken={testToken}
    />
  );
}
