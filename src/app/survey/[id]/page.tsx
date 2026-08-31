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
  // ?fw=1 — 실사 조사 대상 화면이 붙이는 **힌트**(티켓 27). 대행 배너를 물을지만 정하고
  // 권한은 아무것도 주지 않는다 — 귀속·차단 판정은 서버가 세션으로 한다. 이 힌트가 없으면
  // 초대 응답자 전원이 배너 조회를 한 번씩 하게 되어 「응답자 화면 diff 0」이 깨진다.
  const proxyHint = searchParams?.get('fw') === '1';

  return (
    <SurveyResponseFlow
      surveyIdentifier={identifier}
      inviteToken={inviteToken}
      testToken={testToken}
      proxyHint={proxyHint}
    />
  );
}
