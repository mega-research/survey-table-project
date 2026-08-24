import type { Metadata } from 'next';

import { SurveyResponseFlow } from '@/features/survey-response/survey-response-flow';
import {
  InvalidInviteLinkScreen,
  InvalidTestLinkScreen,
} from '@/features/survey-response/survey-response-screens';
import type { ResponseEntrySeed } from '@/shared/contracts/survey-builder-io';
import * as contactAttrsSvc from '@/server/contacts/services/contact-attrs.service';
import { resolveInviteCode } from '@/server/contacts/services/contact-invite.service';
import { getSurveyForResponse } from '@/server/survey-builder/services/survey-read.service';

/**
 * 짧은 초대 링크도 공개 응답 표면이다 — 루트 layout 의 robots: 'index, follow' 를
 * 상속하지 않도록 noindex 로 덮는다 (/survey/[id]/layout.tsx, /preview/[token] 과 동일).
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ code: string }>;
}

export default async function ShortInvitePage({ params }: PageProps) {
  const { code } = await params;
  const resolved = await resolveInviteCode(code);
  if (!resolved) return <InvalidInviteLinkScreen />;
  if (resolved.kind === 'invalid_test') return <InvalidTestLinkScreen />;

  // 이 페이지는 이미 서버에서 돈다. 설문과 컨택 attrs 까지 여기서 조회해 넘기면
  // 응답자가 첫 화면을 보기까지의 순차 왕복이 사라진다(같은 리전의 DB 조회로 바뀐다).
  // **판정은 담지 않는다** — 설문 없음·비공개·초대 필수·무효 토큰 분기는 종전대로
  // 클라이언트 로더가 한 곳에서 내린다. 여기 복제하면 두 진입 경로가 조용히 갈라진다.
  const entrySeed = await loadEntrySeed(resolved.surveyId, resolved.inviteToken);

  return (
    <SurveyResponseFlow
      surveyIdentifier={resolved.accessIdentifier}
      // 초대 코드를 풀면서 설문 id 를 이미 조회했다. 넘기지 않으면 클라이언트가
      // 슬러그·비공개 토큰으로 같은 답을 한 번 더 물어 왕복이 하나 늘어난다.
      resolvedSurveyId={resolved.surveyId}
      entrySeed={entrySeed}
      inviteToken={resolved.inviteToken}
      testToken={null}
    />
  );
}

/**
 * 진입 자료 조회. 조회만 하고 판정하지 않는다.
 *
 * 설문 조회와 attrs 조회는 서로를 기다릴 이유가 없어 나란히 돌린다 — 클라이언트에서는
 * surveyId 를 먼저 알아야 해서 불가능했던 병렬이다.
 *
 * attrs 는 RPC 경로와 같은 의미론으로 접는다. 무효 토큰은 서비스가 null 로 흡수하고,
 * 테스트 링크 만료는 InvalidTestLinkError 로 던지며(RPC 의 INVALID_TEST_LINK 와 같다),
 * 그 밖의 오류는 fail-open — 이미 조회한 설문을 에러 화면으로 막지 않고 익명으로 강등한다.
 */
async function loadEntrySeed(surveyId: string, inviteToken: string): Promise<ResponseEntrySeed> {
  const [forResponse, attrs] = await Promise.all([
    getSurveyForResponse({ surveyId, inviteToken }),
    contactAttrsSvc
      .lookupContactAttrs({ surveyId, inviteToken })
      .then((value) => ({ kind: 'ok' as const, value }))
      .catch((error: unknown) => {
        if (error instanceof contactAttrsSvc.InvalidTestLinkError) {
          return { kind: 'invalid_test' as const };
        }
        console.error('contact attrs 조회 오류 (익명 폴백):', error);
        return { kind: 'ok' as const, value: null };
      }),
  ]);

  return {
    forResponse,
    contactAttrs: attrs.kind === 'ok' ? attrs.value : null,
    ...(attrs.kind === 'invalid_test' ? { attrsInvalidTest: true } : {}),
  };
}
