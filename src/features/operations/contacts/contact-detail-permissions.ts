/**
 * 단건 상세 화면이 **무엇을 그릴지** (ADR-0026, 티켓 08).
 *
 * 폼은 클라이언트 컴포넌트라 capability 집합(`ReadonlySet`)을 그대로 받을 수 없다. 서버가
 * 판정을 불리언으로 풀어 넘기고, **푸는 자리는 한 곳**(`contactDetailPermissions`)이다 —
 * 화면마다 `capabilities.has(...)` 를 흩뿌리면 어느 버튼이 무엇을 요구하는지가 코드 전체에
 * 흩어져, 서버 관문과 어긋나도 아무도 모른다.
 *
 * 각 칸의 요구는 그 동작이 부르는 표면의 관문에서 그대로 옮긴 것이다. 갈리면 「보이는데
 * 누르면 거부」가 되고, 그것이 티켓 02 가 헤더·탭에서 고친 회귀와 같은 종류다.
 */
import type { SurveyCapability } from '@/shared/contracts/workspace';

export interface ContactDetailPermissions {
  /** 명단 수정 — attrs·PII 입력, 컬럼 표시 토글, 대상 삭제 (`contacts.manage`). */
  manageContacts: boolean;
  /** 회차 기록과 메모·연락 방법 저장 (`contacts.writeAttempts`). */
  writeAttempts: boolean;
  /** 응답 수정·초기화·재응답 허용과 편집 이력 (`responses.view`). */
  manageResponses: boolean;
  /** 메일 발송 이력 카드와 단건 발송 (`mail.view`·`mail.send`). */
  viewMail: boolean;
  sendMail: boolean;
  /**
   * 대행 진입점(초대 링크)을 그릴 것인가 — **capability 축이 아니다.**
   *
   * 그 링크는 곧 그 사람의 응답 화면이라, 볼 수 있다는 것과 대신 눌러도 된다는 것이 다르다.
   * 판정은 서버 투영이 하고(`ContactDetailScreen`), 화면은 결과만 받는다 — 여기서 화면이
   * 버튼만 감추면 토큰이 RSC payload 로 나가고 그 주소는 `pub` 경로라 서버가 다시 못 막는다.
   */
  proxyRespond: boolean;
}

export function contactDetailPermissions(
  capabilities: ReadonlySet<SurveyCapability>,
  options: { proxyRespond: boolean },
): ContactDetailPermissions {
  return {
    manageContacts: capabilities.has('contacts.manage'),
    writeAttempts: capabilities.has('contacts.writeAttempts'),
    manageResponses: capabilities.has('responses.view'),
    viewMail: capabilities.has('mail.view'),
    sendMail: capabilities.has('mail.send'),
    proxyRespond: options.proxyRespond,
  };
}
