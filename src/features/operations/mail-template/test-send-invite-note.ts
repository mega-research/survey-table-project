/**
 * 테스트 발송 완료 문구에 덧붙이는 초대 링크 안내 — 서버가 알려 준 링크 종류(`inviteLink`)를 글자로 옮긴다
 * (CONTEXT.md 「테스트 발송」). 종류를 모르면 적지 않는다.
 */
export function testSendInviteNote(inviteLink: 'live' | 'sandbox' | undefined): string | null {
  if (inviteLink === 'live') {
    return '초대 링크는 눌러서 열리는 테스트 링크입니다. 받은 사람이 로그인 없이 설문을 끝까지 응답해 볼 수 있고, 응답은 테스트 데이터로만 쌓입니다.';
  }
  if (inviteLink === 'sandbox') {
    return '초대 링크는 열리지 않는 견본입니다. 테스트 모드를 켜고 「테스트 조사 대상자 생성」을 해 둔 설문에서는 눌러서 열리는 테스트 링크가 들어갑니다.';
  }
  return null;
}
