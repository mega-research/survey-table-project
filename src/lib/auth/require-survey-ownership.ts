/**
 * 설문 접근 실패의 에러 어휘.
 *
 * 원래 이 파일에는 "인증된 사용자면 전 설문 접근" 가드(`requireSurveyOwnership`)가 있었다.
 * 티켓 07 이 판정을 `server/survey-access.ts` 하나로 모으면서 그 함수는 걷어냈고, 남은 것은
 * survey-response 서비스 둘(`response-manage`·`response-edit`)이 던지고 procedure 가
 * NOT_FOUND 로 매핑하는 이 에러뿐이다.
 *
 * 그 두 서비스의 관문이 capability 로 바뀌면(티켓 09~11) `SurveyAccessError` 로 흡수되고
 * 이 파일도 사라진다 — 지금 옮기면 매핑 4곳이 함께 흔들려 배선 티켓과 충돌한다.
 */
export class SurveyOwnershipError extends Error {
  constructor(public readonly reason: 'not_found') {
    super(reason);
    this.name = 'SurveyOwnershipError';
  }
}
