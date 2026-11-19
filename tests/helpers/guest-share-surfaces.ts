/**
 * 게스트에게 열린 표면마다 **담당 범위를 어떻게 다루는가** — 등재표 (`.scratch/guest-target-share/PRD.md`).
 *
 * 담당 범위에 묶인 게스트(`guest-grants` 의 `GUEST_TARGET_SHARES`)는 한 설문의 조사 대상 일부만 본다.
 * 게스트가 닿는 표면 하나라도 범위를 거르지 않고 열려 있으면 남의 범위 명단(연락처 평문)이 샌다. 그래서
 * 표면마다 셋 중 하나를 적는다 — 「아직 안 거름」 범주는 없다.
 *
 * - `FILTERED` — 범위 게스트에게 열고, 담당 범위로 거른다(`server/fieldwork-share-scope` 의 술어).
 *   실제로 거르는지는 실DB 스위트(`tests/integration/guest-target-share.realdb.test.ts`)가 두 계정으로 본다.
 * - `exempt(사유)` — 범위 게스트에게 열되 거를 것이 없다. 조사 대상 데이터를 읽지도 돌려주지도 않는다.
 * - `CLOSED` — 범위 게스트에게 닫는다. procedure 는 `assertSurveyAccess`·`assertSurveyWriteAccess` 가,
 *   페이지는 `requireSurveyConsolePage` 의 기본 정책과 미들웨어가 거부한다.
 *
 * `tests/repo/guest-share-surfaces.test.ts` 가 이 표를 scoped procedure 소스·페이지 가드 표와 맞춘다 —
 * 새 scoped procedure 나 게스트용 화면을 만들면 여기 한 줄을 쓰기 전까지 빨개진다.
 */
export type ShareSurfaceStatus =
  | { kind: 'filtered' }
  | { kind: 'exempt'; reason: string }
  | { kind: 'closed' };

export const FILTERED: ShareSurfaceStatus = { kind: 'filtered' };
export const CLOSED: ShareSurfaceStatus = { kind: 'closed' };
export const exempt = (reason: string): ShareSurfaceStatus => ({ kind: 'exempt', reason });

/** scoped procedure — 키는 `<도메인>/<파일>:<이름>` (`orpc-scoped-write-guard.test.ts` 와 같은 모양). */
export const SCOPED_SHARE_SURFACES: Record<string, ShareSurfaceStatus> = {
  // 조사 대상 — 목록의 값 목록·단건 쓰기
  'contacts/attr-values:list': FILTERED,
  'contacts/attr-values:nonNumericCount': FILTERED,
  'contacts/id-lists:create': exempt(
    '번호 목록을 저장할 뿐 대상을 읽지 않는다 — 읽는 쪽(목록의 필터 해석)이 범위를 건다',
  ),
  'contacts/targets:add': FILTERED,
  'contacts/targets:update': FILTERED,
  'contacts/attempts:add': FILTERED,
  'contacts/attempts:update': FILTERED,
  'contacts/attempts:remove': FILTERED,

  // 메일 — 단건만 연다
  'mail/campaigns:sendSingle': FILTERED,
  'mail/preview:sample': FILTERED,
  'mail/campaigns:create': CLOSED,
  'mail/campaigns:cancel': CLOSED,
  'mail/campaigns:resync': CLOSED,
  'mail/campaigns:fetchCandidateIds': CLOSED,
  'mail/campaigns:previewPreflight': CLOSED,
  'mail/preview:testSend': CLOSED,
  'mail/templates:create': CLOSED,
  'mail/templates:update': CLOSED,
  'mail/templates:remove': CLOSED,

  // 응답 수정
  'survey-response/edit:saveAdminEdit': FILTERED,

  // 조사표 — 빌더·문항 수요 화면의 것이라 범위 게스트가 쓸 자리가 없다
  'survey-document/documents:list': CLOSED,
  'survey-document/documents:attach': CLOSED,
  'survey-document/documents:remove': CLOSED,
  'survey-document/anchors:list': CLOSED,
  'survey-document/anchors:create': CLOSED,
  'survey-document/anchors:remove': CLOSED,
};

/** 입력에 surveyId 가 없어 설문 단위 판정을 하지 않는 scoped procedure — 범위도 판정할 수 없다. */
export const NO_SURVEY_ID_SCOPED = new Set(['media/media:deleteMailAttachmentTmp']);

/**
 * 범위 게스트에게 여는 화면(`admin-page-guard.test.ts` 표의 `share: 'allow'`) — 키는 `src/app` 기준 경로.
 * 닫힌 화면은 여기 적지 않는다(가드 표가 쥔다).
 */
export const PAGE_SHARE_SURFACES: Record<string, ShareSurfaceStatus> = {
  'admin/surveys/[id]/preview': FILTERED,
  'admin/surveys/[id]/operations/overview': FILTERED,
  'admin/surveys/[id]/operations/profiles': FILTERED,
  'admin/surveys/[id]/operations/profiles/[responseId]/edit': FILTERED,
  'admin/surveys/[id]/operations/profiles/[responseId]/view': FILTERED,
  'admin/surveys/[id]/operations/contacts': FILTERED,
  'admin/surveys/[id]/operations/contacts/[contactId]': FILTERED,
  'admin/surveys/[id]/operations/contacts/new': exempt(
    '스킴·결과코드만 읽는다 — 저장(contacts.targets.add)이 추가하는 대상에 범위 값을 찍는다',
  ),
  'admin/surveys/[id]/operations/report': FILTERED,
};

/**
 * 게스트를 받는 REST 주소 — 키는 `src/app/api` 기준 라우트 파일 경로. 전부 범위 게스트에게 닫혀 있다
 * (파일이 명단·응답 전체를 낸다). 판정 함수는 라우트마다 다르다.
 */
export const REST_SHARE_CLOSED: Record<string, { via: string }> = {
  'surveys/[surveyId]/contacts/export/route.ts': { via: 'isShareRestrictedGuest(' },
  'surveys/[surveyId]/demand-summary/route.ts': { via: 'isShareRestrictedGuest(' },
  // 내보내기 둘은 `canExportSurveyData` 가 범위 게스트를 어떤 종류에도 거부한다
  'surveys/[surveyId]/export/route.ts': { via: 'canExportSurveyData(' },
  'surveys/[surveyId]/export/split-preview/route.ts': { via: 'canExportSurveyData(' },
};
