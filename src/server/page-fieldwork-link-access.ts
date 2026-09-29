import 'server-only';

import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import type { SurveyCapability } from '@/shared/contracts/workspace';

import { resolveLinkActor } from './fieldwork-link';
import { type LinkActor, loadSurveyAccess, SurveyAccessError } from './survey-access';

/**
 * 외주 실사 링크 콘솔 화면의 관문 — `page-guest-access`·`page-fieldwork-access` 의 링크 짝
 * (ADR-0026, 티켓 06).
 *
 * 형제 둘과 **입력이 다르다.** 저쪽은 세션 계정과 설문 id 로 묻는데, 여기는 주소의
 * **토큰** 하나로 묻는다 — 외주는 계정이 없고, 설문 id 는 링크 행이 정한다. 그래서 이
 * 함수가 설문 id 를 **받지 않고 돌려준다**: 화면이 id 를 URL 에서 읽을 수 있으면 다른
 * 설문을 지목할 여지가 생긴다.
 *
 * 거부가 갈리는 방식도 다르다.
 *  - **접속 전**(쿠키 없음·비밀번호 변경으로 끊김) → 입구 화면으로 **redirect**. notFound 로
 *    접으면 외주는 「링크가 죽었다」고 읽고 연구원에게 문의한다 — 실제로는 비밀번호를 다시
 *    넣으면 되는 상태다.
 *  - **닫힘**(중단·종료·삭제·배치 대기) → 역시 입구 화면. 거기서 닫힘 안내를 그린다.
 *    문구를 두 곳에 두면 한쪽만 고쳐진다.
 *  - **capability 부족** → notFound. 여기까지 온 것은 유효한 세션이므로 남은 차이는
 *    「이 화면을 볼 자격이 없다」 하나이고, 그것은 갈라 말할 것이 없다.
 *
 * **leaf 마다 자기 capability 를 준다**(AGENTS 「RSC 페이지는 자기 가드를 갖는다」). 조사
 * 대상은 `contacts.view`, 현황·진척은 `operations.view` 다. 오늘 링크 열에서 두 칸이 함께
 * 켜져 결과가 같지만, 물어야 할 것을 묻지 않으면 한쪽이 닫히는 날 명단이 열린 채 남는다.
 *
 * tests/repo/rsc-page-guards.test.ts 와 survey-boundary-guards.test.ts 의 가드 목록에
 * 등재돼 있다 — 이름을 바꾸면 그 정규식도 함께 바꿀 것.
 */
export interface FieldworkLinkPageViewer {
  actor: LinkActor;
  /** 이 링크가 여는 설문 — 화면은 이 값만 쓴다(주소에서 읽지 않는다). */
  surveyId: string;
  /** 판정 결과 그대로. 헤더·탭·버튼이 이것으로 무엇을 그릴지 정한다. */
  capabilities: ReadonlySet<SurveyCapability>;
}

export async function assertFieldworkLinkPageAccess(
  token: string,
  capability: SurveyCapability,
): Promise<FieldworkLinkPageViewer> {
  const session = await resolveLinkActor(token, await headers());
  // 사유 셋(unknown·closed·unauthenticated)이 모두 입구 화면으로 모인다 — 그 화면이 이미
  // 「닫힘」과 「비밀번호를 다시」를 갈라 그린다.
  if (!session.ok) redirect(`/fw/${encodeURIComponent(token)}`);

  let access;
  try {
    access = await loadSurveyAccess(session.actor, session.actor.surveyId);
  } catch (error) {
    // 없는 설문·삭제된 설문은 코어가 not_found 로 던진다. 그 밖의 예외(DB 장애)는 404 로
    // 접지 않는다 — 조용한 404 는 장애를 「권한 없음」으로 오독하게 만든다.
    if (error instanceof SurveyAccessError) notFound();
    throw error;
  }
  if (!access.capabilities.has(capability)) notFound();

  return {
    actor: session.actor,
    surveyId: session.actor.surveyId,
    capabilities: access.capabilities,
  };
}
