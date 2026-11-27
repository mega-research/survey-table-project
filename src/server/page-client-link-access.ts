import 'server-only';

import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { clientLinkPath } from '@/lib/survey-url';
import {
  type ClientLinkTab,
  type ClientLinkTabs,
  isClientLinkTabOpen,
} from '@/shared/contracts/workspace';

import { resolveClientLinkActor } from './access-link';
import { loadSurveyAccess, SurveyAccessError } from './survey-access';

/**
 * 클라이언트 링크 콘솔 화면의 관문 (ADR-0029) — 형제 둘의 교차점이다.
 *
 * - **입력은 `page-fieldwork-link-access` 를 닮았다**: 주소의 **토큰** 하나로 묻는다.
 *   클라이언트에게는 계정이 없고 설문 id 는 링크 행이 정한다. 그래서 이 함수가 설문 id 를
 *   **받지 않고 돌려준다** — 화면이 id 를 주소에서 읽을 수 있으면 다른 설문을 지목할 여지가
 *   생긴다.
 * - **묻는 것은 `page-guest-access` 를 닮았다**: capability(`operations.view`)를 지난 뒤
 *   **탭 화이트리스트**를 다시 본다. 클라이언트가 갖는 권한은 어느 설문에서나 같고, 설문마다
 *   달라지는 것은 그 안에서 어느 화면이 열리는가다.
 *
 * 거부가 두 갈래다.
 *  - **접속 전 · 세션 끊김 · 닫힘 → 입구로 redirect.** notFound 로 접으면 클라이언트는 「링크가
 *    죽었다」고 읽고 연구원에게 문의한다 — 실제로는 비밀번호를 다시 넣으면 되는 상태일 수
 *    있다. 닫힘 안내도 입구가 그린다(문구를 두 곳에 두면 한쪽만 고쳐진다). 없는 토큰도 같은
 *    길이다: 입구가 비밀번호 화면을 그리고, 거기서 어떤 비밀번호도 통하지 않는다.
 *  - **탭 밖 → notFound.** 여기까지 온 것은 유효한 세션이고, 남은 차이는 「이 화면이 열려
 *    있지 않다」 하나다. **사유를 갈라 말하지 않는다** — 주소를 바꿔 넣어 보는 것으로 연구원이
 *    무엇을 켜고 껐는지가 확인되면 안 된다.
 *
 * `tab` 을 생략하면 탭 축을 묻지 않는다. 화면 머리(레이아웃)와 「열린 화면이 없습니다」 안내가
 * 그 경우다. **설문 보기도 칩이다**(`preview`) — 미리보기 페이지는 그 칩으로 묻는다. 예전에는
 * 화이트리스트 밖이라 언제나 열렸는데, 설문지를 보이지 않아야 하는 조사(리멤버 패널)가 생겼다.
 *
 * **탭은 매 요청 링크 행에서 온다**(세션 판정이 읽어 주체에 싣는다). 쿠키에 없으므로 연구원이
 * 탭을 끄면 클라이언트의 다음 화면 이동에서 그 탭이 닫힌다.
 *
 * tests/repo/rsc-page-guards.test.ts 와 survey-boundary-guards.test.ts 의 가드 목록에
 * 등재돼 있다 — 이름을 바꾸면 그 정규식도 함께 바꿀 것.
 */
export interface ClientLinkPageViewer {
  /** 이 링크가 여는 설문 — 화면은 이 값만 쓴다(주소에서 읽지 않는다). */
  surveyId: string;
  /**
   * 관문이 승인한 링크 — 응답 내역의 열 설정·응답 조회 키는 이 링크로 묶는다. 설문 id 로 「지금 활성인
   * 링크」를 다시 찾으면 그사이 링크가 바뀌었을 때 남의 링크 설정이 적용된다.
   */
  linkId: string;
  /** 지금 켜진 칩 — 탭 바·화면 머리·응답 현황 본문이 그대로 그린다. */
  tabs: ClientLinkTabs;
}

/**
 * 관문의 판정만 — 던지지 않고 결과를 돌려준다. 페이지(아래 `assertClientLinkPageAccess`)와 파일을 내려
 * 주는 Route Handler(응답 내역 엑셀)가 같은 판정을 쓴다 — 둘이 따로 짜면 칩·capability·종류 확인 중
 * 하나가 한쪽에서 빠진다.
 *  - `entrance` — 접속 전·세션 끊김·닫힘·없는 토큰(입구로 보낸다)
 *  - `denied` — 유효한 세션이지만 이 화면이 열려 있지 않다(사유를 갈라 말하지 않는다)
 */
export type ClientLinkAccessCheck =
  | { kind: 'ok'; viewer: ClientLinkPageViewer }
  | { kind: 'entrance' }
  | { kind: 'denied' };

export async function checkClientLinkAccess(
  token: string,
  requestHeaders: Headers,
  tab?: ClientLinkTab,
): Promise<ClientLinkAccessCheck> {
  const session = await resolveClientLinkActor(token, requestHeaders);
  // 사유 셋(unknown·closed·unauthenticated)이 모두 입구로 모인다 — 그 화면이 이미 「닫힘」과
  // 「비밀번호를 다시」를 갈라 그린다.
  if (!session.ok) return { kind: 'entrance' };

  let access;
  try {
    access = await loadSurveyAccess(session.actor, session.actor.surveyId);
  } catch (error) {
    // 없는 설문·삭제된 설문은 코어가 not_found 로 던진다. 그 밖의 예외(DB 장애)는 404 로
    // 접지 않는다 — 조용한 404 는 장애를 「권한 없음」으로 오독하게 만든다.
    if (error instanceof SurveyAccessError) return { kind: 'denied' };
    throw error;
  }

  if (!access.capabilities.has('operations.view')) return { kind: 'denied' };
  // 칩은 주체가 든 값을 읽는다 — 판정 코어의 `guestTabs` 는 게스트 넷만 아는 모양이라 칩 셋이
  // 타입에서 빠진다. 값은 같다: 코어가 클라이언트 주체에게 돌려주는 것이 바로 이 객체다
  // (capability 가 비면 위에서 이미 막혔다). 종류는 입구가 WHERE 로 못 박았지만 방어적으로
  // 다시 접는다 — 탭이 없는 주체를 「전부 열림」으로 읽는 실수가 가장 넓게 새는 자리다.
  if (session.actor.linkKind !== 'client') return { kind: 'denied' };
  const tabs = session.actor.clientTabs;
  // 딸린 칩(엑셀 다운로드·응답 조회·상세 통계)은 부모가 꺼지면 값과 무관하게 닫힌다.
  if (tab !== undefined && !isClientLinkTabOpen(tabs, tab)) return { kind: 'denied' };

  return {
    kind: 'ok',
    viewer: { surveyId: session.actor.surveyId, linkId: session.actor.linkId, tabs },
  };
}

export async function assertClientLinkPageAccess(
  token: string,
  tab?: ClientLinkTab,
): Promise<ClientLinkPageViewer> {
  const check = await checkClientLinkAccess(token, await headers(), tab);
  if (check.kind === 'entrance') redirect(clientLinkPath(encodeURIComponent(token)));
  if (check.kind === 'denied') notFound();
  return check.viewer;
}
