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
  // 패널 연동 — 링크에 붙어 온 회원 식별값(?euid=)을 종료 주소·응답 행으로 이어 넘긴다.
  // 어떤 이름을 고를지는 설정이 정하므로 쿼리 전체를 넘긴다.
  const entryQuery = searchParams?.toString() ?? '';

  return (
    <SurveyResponseFlow
      surveyIdentifier={identifier}
      inviteToken={inviteToken}
      testToken={testToken}
      entryQuery={entryQuery}
    />
  );
}
