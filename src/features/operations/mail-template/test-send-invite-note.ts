/**
 * 템플릿 미리보기 다이얼로그의 초대 링크 안내 글자 — 서버가 알려 준 값을 글자로 옮긴다
 * (CONTEXT.md 「테스트 발송」).
 */

/** 테스트 발송 완료 문구에 덧붙이는 안내. 링크 종류를 모르면 적지 않는다. */
export function testSendInviteNote(inviteLink: 'live' | 'sandbox' | undefined): string | null {
  if (inviteLink === 'live') {
    return '초대 링크는 첫 번째 테스트 조사 대상자의 링크입니다. 받은 사람이 로그인 없이 설문을 끝까지 응답해 볼 수 있고, 응답은 테스트 데이터로만 쌓입니다.';
  }
  if (inviteLink === 'sandbox') {
    return '초대 링크는 열리지 않는 견본입니다. 테스트 모드를 켜고 「테스트 조사 대상자 생성」을 해 둔 설문에서는 눌러서 열리는 테스트 링크가 들어갑니다.';
  }
  return null;
}

/**
 * 미리보기 머리의 샘플 안내 — 어느 대상의 값으로 채웠는지와, 화면에 보이는 설문 링크를 누르면 무슨 일이
 * 생기는지. 실제 조사 대상의 링크는 누르면 그 대상의 실제 응답이 시작된다(2026-11-11 실제로 생겼다).
 */
export function previewSampleDescription(sample: { resid: number; isTest?: boolean | undefined }): string {
  if (sample.isTest) {
    return `테스트 조사 대상 (resid #${sample.resid}) 데이터로 변수를 치환했습니다. 화면의 설문 링크는 눌러서 열리는 테스트 링크이고, 테스트 발송도 같은 값·같은 링크로 나갑니다.`;
  }
  return `첫 번째 조사 대상 (resid #${sample.resid}) 데이터로 변수를 치환했습니다. 화면의 설문 링크는 이 대상의 실제 링크라, 누르면 실제 응답이 시작됩니다.`;
}
