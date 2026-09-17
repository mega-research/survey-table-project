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
  'mail.templates.create': { input: MAIL_TEMPLATE_INPUT },
  'mail.templates.update': { templateId: CHILD_ID, input: MAIL_TEMPLATE_INPUT },
  'mail.templates.remove': { templateId: CHILD_ID },
  'mail.preview.sample': { contactTargetId: CHILD_ID },
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
