'use client';

import { useParams, useSearchParams } from 'next/navigation';

import { SurveyResponseFlow } from '@/components/survey-response/survey-response-flow';

export default function SurveyResponsePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  // URL 인코딩된 한글 slug를 디코딩 (원본 page.tsx 동작 보존)
  const identifier = decodeURIComponent(params.id as string);
  const inviteToken = searchParams?.get('invite') ?? null;

  return (
    <SurveyResponseFlow
      surveyIdentifier={identifier}
      inviteToken={inviteToken}
    />
  );
}
