/**
 * scoped 표면 전수와 그 최소 입력 — cross-survey 음성 스위트의 공용 인벤토리.
 *
 * **두 스위트가 같은 목록을 봐야 한다.** 게스트(티켓 23)와 실사(티켓 28)가 각자 표를 들면,
 * 새 scoped procedure 가 붙었을 때 한쪽만 빨개지고 다른 쪽은 영원히 초록으로 남는다 —
 * 그 상태는 「전수」가 거짓이 된 것인데 화면상으로는 통과다.
 *
 * `scoped` 는 **비내부 계정이 지나는 유일한 베이스**라 이 목록이 곧 「밖에서 두드릴 수 있는
 * 문」의 전부다. 목록의 출처는 라우터이고, 두 스위트가 각자 열거 결과와 이 표를 대조한다.
 */

/**
 * 하위 행 id — **존재하지 않는 uuid** 다. 관문이 서면 하위 id 가 무엇이든 거기서 멈춰야
 * 하고, 실재하는 행을 넣으면 「없어서 막힌 것」과 구별되지 않는다.
 */
export const CHILD_ID = crypto.randomUUID();

/** 메일 템플릿 입력의 필수 칸 — 발신 표기까지 전부 요구된다. */
const MAIL_TEMPLATE_INPUT = {
  name: '주입 템플릿',
  subject: '주입',
  bodyHtml: '<p>주입</p>',
  fromLocal: 'no-reply',
  fromName: '메가리서치',
  replyTo: 'ops@megaresearch.co.kr',
};

/**
 * 표면 → 설문 id 를 뺀 최소 입력.
 *
 * 관문이 handler 첫 줄이라 그 뒤 값은 읽히지 않는다 — zod 검증만 통과하면 된다. 하위
 * id 는 **존재하지 않는 uuid** 를 넣는다: 관문이 서면 하위 id 가 무엇이든 거기서 멈춰야
 * 하고, 실재하는 행을 넣으면 「없어서 막힌 것」과 구별되지 않는다.
 */
export const SCOPED_INPUTS: Record<string, Record<string, unknown>> = {
  'contacts.targets.add': { attrs: {} },
  'contacts.targets.update': { id: CHILD_ID, attrs: {} },
  'contacts.targets.setMemo': { id: CHILD_ID, memo: null, contactMethod: null },
  'contacts.attempts.add': { contactTargetId: CHILD_ID, resultCode: 'x' },
  'contacts.attempts.update': { contactTargetId: CHILD_ID, id: CHILD_ID, resultCode: 'x' },
  'contacts.attempts.remove': { contactTargetId: CHILD_ID, id: CHILD_ID },
  'contacts.attrValues.list': { attrsKey: 'k' },
  'contacts.attrValues.nonNumericCount': { attrsKey: 'k' },
  'contacts.idLists.create': { ids: [1] },
  'mail.templates.create': { input: MAIL_TEMPLATE_INPUT },
  'mail.templates.update': { templateId: CHILD_ID, input: MAIL_TEMPLATE_INPUT },
  'mail.templates.remove': { templateId: CHILD_ID },
  'mail.preview.sample': { contactTargetId: CHILD_ID },
  'mail.preview.contactSample': { contactTargetId: CHILD_ID },
  'mail.preview.testSend': {
    to: 'ops@megaresearch.co.kr',
    subject: '주입',
    bodyHtml: '<p>주입</p>',
    fromName: '메가리서치',
    fromLocal: 'no-reply',
    replyTo: 'ops@megaresearch.co.kr',
  },
  'mail.campaigns.create': { mailTemplateId: CHILD_ID, title: 'x', contactTargetIds: [CHILD_ID] },
  'mail.campaigns.cancel': { campaignId: CHILD_ID },
  'mail.campaigns.resync': { campaignId: CHILD_ID },
  'mail.campaigns.fetchCandidateIds': { filter: {} },
  'mail.campaigns.previewPreflight': { selectedContactIds: [CHILD_ID] },
  'mail.campaigns.sendSingle': { contactTargetId: CHILD_ID, mailTemplateId: CHILD_ID },
  'surveyResponse.edit.saveAdminEdit': {
    responseId: CHILD_ID,
    questionResponses: {},
    versionId: CHILD_ID,
  },
};

export const SCOPED_PATHS = Object.keys(SCOPED_INPUTS).sort();

/**
 * 외주 실사 링크에게 **열리는** scoped 표면 (ADR-0026 티켓 06, ADR-0027).
 *
 * 링크 열은 capability 여섯이고(`survey.view`·`operations.view`·`contacts.view`·
 * `contacts.writeAttempts`·`responses.view`·`mail.sendSingle`) 그중 scoped 표면이 실제로 요구하는
 * 것은 뒤의 넷이다. 그래서 여기 있는 열이 「밖에서 두드려 통과하는 문」의 전부다 — 이 목록이
 * 곧 외주에게 나가는 쓰기 반경이므로, 한 줄이 늘면 리뷰가 그 줄을 보게 된다.
 *
 * ADR-0027 이 더한 셋 — 응답 수정 저장·단건 발송·단건 발송 창의 미리보기. 홀짝 조건 상태줄
 * (`contacts.attrValues.nonNumericCount`)은 조사 대상 필터의 일부라 `attrValues.list` 와 같은 권한으로 열린다. 메일 탭(템플릿·
 * 단체 메일·테스트 발송)과 템플릿 편집기의 미리보기(`mail.preview.sample`)는 여전히 막힌 쪽이다.
 *
 * 나머지는 파생이다(`LINK_BLOCKED_SCOPED_PATHS`). 새 scoped procedure 가 붙으면 자동으로
 * **막힌 쪽**에 들어가고, 실제로 열려 있다면 음성 스위트가 그 자리에서 빨개진다 — 안전한
 * 방향으로 기본값이 선다.
 */
export const LINK_OPEN_SCOPED_PATHS = [
  'contacts.attempts.add',
  'contacts.attempts.remove',
  'contacts.attempts.update',
  'contacts.attrValues.list',
  'contacts.attrValues.nonNumericCount',
  'contacts.idLists.create',
  'contacts.targets.setMemo',
  'mail.campaigns.sendSingle',
  'mail.preview.contactSample',
  'surveyResponse.edit.saveAdminEdit',
] as const;

export const LINK_BLOCKED_SCOPED_PATHS = SCOPED_PATHS.filter(
  (path) => !(LINK_OPEN_SCOPED_PATHS as readonly string[]).includes(path),
);
