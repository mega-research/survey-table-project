/**
 * soft delete 음성 스위트의 표면 인벤토리 (역할 모델 v2 티켓 17).
 *
 * 티켓의 마지막 체크박스는 「조회 경로 전수에 deletedAt 필터 누락 없음」이다. "전수" 를
 * 사람이 적으면 새로 붙은 경로는 영원히 초록이므로, 티켓 15 와 같은 방식으로 목록의 출처를
 * 라우터에 둔다 — 다만 **검증은 실 DB 에서만 가능하다.**
 *
 * 목으로 못 하는 이유가 이 파일의 존재 이유다. 목이 돌려주는 행은 언제나 테스트가 정한
 * 행이라 WHERE 에 `deleted_at IS NULL` 이 있든 없든 같은 결과가 나온다. 그래서 역할이 갈린다.
 *  - **이 파일 + 열거 가드**(`pnpm test`) : 인벤토리가 라우터와 일치하는가. 새 pub 표면이
 *    붙으면 그 자리에서 빨개져 등재를 강요한다.
 *  - **realdb 스위트**(`pnpm test:integration`) : 등재된 표면이 실제로 삭제된 설문을
 *    거부하는가.
 *
 * 내부(authed·scoped·superadmin) 표면은 여기 없다. 그쪽은 capability 코어 하나가
 * `deleted_at IS NULL` 로 조회해 전부 not_found 로 접으므로(loadSurveyCapabilities),
 * 표면마다 확인할 것이 아니라 코어 한 곳을 확인하면 된다 — realdb 스위트가 그렇게 한다.
 * 관문이 없는 **응답자(pub) 경로**만 각자 조건을 걸어야 하고, 그래서 여기 목록이 pub 이다.
 *
 * **이 목록이 다루지 않는 축이 하나 있다 — `responseId` 로만 지목하는 진행 중 응답 쓰기**
 * (`response.updateAnswer`·`saveDraft`, `lifecycle.stepVisit`·`visibilitySegment`). 자동 탐지가
 * `surveyId` 키를 보므로 열거에 안 잡히고, 실제로도 삭제 뒤 열려 있던 탭은 답변을 계속 쓴다
 * (`assertSurveyNotPaused` 는 제어 플래그 미조회를 fail-open 으로 접는다).
 *
 * **그것이 지금은 의도된 동작이다.** 삭제는 soft delete 라 그 응답 행이 그대로 보존되고,
 * 제출(`complete`)만 `loadSurveyGateRow` 가 막는다. 응답자는 쓰던 것을 잃지 않고, 설문이
 * 복구되면 진행 중이던 응답을 그대로 이어갈 수 있다 — 답변 도중 갑자기 쓰기가 실패하는 쪽이
 * 응답자에게 더 나쁘고, 무엇보다 이 축으로는 **아무것도 노출되지 않는다**(티켓의 요구는
 * 「미노출 + 데이터 보존」이다). 막으려면 응답자 화면 문구(AcceptanceDenial — 값 자체가 외부
 * 계약이라 「값 변경 금지」)까지 함께 정해야 하므로 별도 결정으로 남긴다.
 *
 * 확장자가 `.test.ts` 가 아니라 vitest include 에 잡히지 않는다 — 테스트가 아니라 조각이다.
 */

/** 삭제된 설문을 만났을 때 그 표면이 보여야 하는 태도. */
export type DeletedSurveyExpectation =
  /** 조회 표면 — 없는 설문과 같은 답(null·undefined·빈 결과). */
  | 'empty'
  /** 쓰기·게이트 표면 — 거부를 던진다. */
  | 'rejects';

export interface PubSurveySurfaceSpec {
  expectation: DeletedSurveyExpectation;
  /** 왜 그 태도인가 — 등재만 하고 사유가 없으면 다음 사람이 판단을 되짚을 수 없다. */
  note: string;
}

/**
 * 설문 id 를 받는 **pub** 표면 전수.
 *
 * 라우터 열거와 대조되므로 유령·누락이 남지 않는다. 새 pub 표면을 만들면
 * `tests/integration/soft-delete-surface-inventory.test.ts` 가 즉시 빨개진다.
 */
export const PUB_SURVEY_SURFACES: Record<string, PubSurveySurfaceSpec> = {
  'surveyBuilder.publicRead.forResponse': {
    expectation: 'empty',
    note: '응답 페이지 첫 조회 — getSurveyById 가 deleted 를 걸러 null 이 된다',
  },
  'contacts.attrs.lookup': {
    expectation: 'empty',
    note: '초대 토큰 attrs — classifyInviteTokenOwner 가 삭제된 설문을 invalid 로 접는다',
  },
  'contacts.priorAnswers.lookup': {
    expectation: 'empty',
    note: '이월 응답 프리필 — lookupPriorAnswers 가 surveys.deleted_at IS NULL 로 조인해 null 을 준다',
  },
  'surveyResponse.proxy.context': {
    expectation: 'empty',
    note: '대행 배너 — loadSurveyAccess 가 삭제된 설문에 not_found 를 던지고 코어가 none 으로 접는다',
  },
  'quota.check': {
    expectation: 'empty',
    note: '쿼터 판정 — getQuotaConfig 가 null 이라 차단하지 않고 통과값을 준다',
  },
  'surveyResponse.response.createWithFirstAnswer': {
    expectation: 'rejects',
    note: '응답 생성 — loadSurveyGateRow 가 survey_not_found 로 막는다',
  },
  'surveyResponse.response.createBlank': {
    expectation: 'rejects',
    note: '빈 응답 생성 — 같은 게이트',
  },
  'surveyResponse.lifecycle.resume': {
    expectation: 'empty',
    note: '이어가기 — 삭제된 설문의 응답 행은 재개 대상이 아니다',
  },
  'surveyResponse.duplicate.checkOnEntry': {
    expectation: 'empty',
    note: '중복 감지 — 진입 자체가 막히므로 판정은 통과값(blocked:false)이면 된다',
  },
};

/**
 * 설문을 **토큰·슬러그로** 지목하는 pub 조회 — 입력 키가 surveyId 가 아니라 자동 탐지가
 * 못 본다. 삭제된 설문을 여는 마지막 열쇠라 realdb 스위트가 반드시 함께 돈다.
 *
 * 여기 적힌 것은 procedure 경로가 아니라 **서비스 함수 이름**이다 — bySlug·byPrivateToken 은
 * procedure 지만 previewToken 은 RSC(/preview/[token])가 서비스를 직접 부르는 경로라,
 * 같은 축을 표면 종류로 갈라 적으면 한쪽을 빠뜨린다.
 */
export const PUB_TOKEN_LOOKUPS = [
  'getSurveyBySlug',
  'getSurveyByPrivateToken',
  'getSurveyByPreviewToken',
  'resolveInviteCode',
] as const;
