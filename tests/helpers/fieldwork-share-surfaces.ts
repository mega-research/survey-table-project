/**
 * 외주 링크가 지나는 표면마다 **담당 범위를 거르는가** — 등재표 (fieldwork-multi-company 티켓 03, ADR-0035).
 *
 * 외주 링크 음성 스위트(`tests/integration/fieldwork-link-denial.test.ts`)가 이 표를 라우터 열거
 * (`LINK_OPEN_SCOPED_PATHS`)와 `src/app/fw` 트리에 맞춘다 — 새 표면이 링크에 열리면 여기 한 줄을 쓰기
 * 전까지 빨개진다. 셋 중 하나다.
 *
 * - `FILTERED` — 담당 범위로 거른다(`server/fieldwork-share` 의 해석·술어를 쓴다). 실제로 거르는지는
 *   실DB 스위트(`fieldwork-share.realdb` 등)가 링크 A·B 세션으로 본다.
 * - `exempt(사유)` — 대상 데이터를 읽지도 돌려주지도 않는다. 사유를 같은 줄에 적는다 — 적을 말이 없으면
 *   거르지 않은 것이다.
 * - `pending('NN')` — 아직 거르지 않는다. 담당 티켓 번호(05~09)를 적는다. 그 티켓이 거르면 `FILTERED` 로
 *   바꾼다. 하나도 남지 않으면 이 상태를 지운다(티켓 11).
 *
 * **표면 하나 = 한 줄**, 담당 티켓별로 묶고 묶음 사이를 빈 줄로 띄운다 — 여러 티켓이 병렬로 자기 줄만
 * 바꿔도 병합이 부딪히지 않게. 한 페이지를 두 티켓이 나눠 맡으면 `페이지#조각` 으로 줄을 가른다.
 *
 * 라우터·파일 트리로 열거할 수 없는 표면도 있다 — 대리 응답 진입(`server/fieldwork-proxy`, 응답 procedure 가
 * 초대 토큰으로 부른다)은 티켓 05 가 진다. 이 표는 그것을 잡지 못한다.
 */
import type { LINK_OPEN_SCOPED_PATHS } from './scoped-surface-inputs';

export type ShareSurfaceStatus =
  | { kind: 'filtered' }
  | { kind: 'exempt'; reason: string }
  | { kind: 'pending'; ticket: '05' | '06' | '07' | '08' | '09' };

export const FILTERED: ShareSurfaceStatus = { kind: 'filtered' };
export const exempt = (reason: string): ShareSurfaceStatus => ({ kind: 'exempt', reason });
export const pending = (ticket: '05' | '06' | '07' | '08' | '09'): ShareSurfaceStatus => ({
  kind: 'pending',
  ticket,
});

type LinkOpenScopedPath = (typeof LINK_OPEN_SCOPED_PATHS)[number];

/** 링크에 열린 scoped procedure — 키 집합이 `LINK_OPEN_SCOPED_PATHS` 와 같아야 한다(tsc + 음성 스위트). */
export const SCOPED_SHARE_SURFACES: Record<LinkOpenScopedPath, ShareSurfaceStatus> = {
  // 03 — 조사 대상 목록의 열 머리 값 목록
  'contacts.attrValues.list': FILTERED,
  'contacts.attrValues.nonNumericCount': FILTERED,
  'contacts.idLists.create': exempt('번호 목록을 저장할 뿐 대상을 읽지 않는다 — 읽는 쪽(목록 해석)이 범위를 건다'),

  // 05 — 단건 표면
  'contacts.attempts.add': FILTERED,
  'contacts.attempts.update': FILTERED,
  'contacts.attempts.remove': FILTERED,
  'contacts.targets.setMemo': FILTERED,
  'mail.campaigns.sendSingle': FILTERED,
  'mail.preview.contactSample': FILTERED,

  // 06 — 응답 수정
  'surveyResponse.edit.saveAdminEdit': FILTERED,
};

/**
 * `/fw` 트리의 RSC — 키는 `src/app` 기준 경로(`page.tsx`·`layout.tsx`), 한 파일을 두 티켓이 나누면
 * `경로#조각`. 파일마다 한 줄 이상 있어야 하고, 없는 파일을 가리키는 줄은 유령이다.
 */
export const FW_PAGE_SHARE_SURFACES: Record<string, ShareSurfaceStatus> = {
  // 해당 없음 — 조사 대상 데이터를 싣지 않는 화면
  'fw/[token]/page.tsx': exempt('비밀번호 화면 — 링크 행과 조사 이름만 읽는다'),
  'fw/[token]/preview/page.tsx': exempt('설문지 미리보기 — 설문 구조만 읽는다'),
  'fw/[token]/operations/layout.tsx': exempt('셸 — 설문 행과 쿼터 계획 유무만 읽는다'),
  'fw/[token]/operations/page.tsx': exempt('조사 대상 목록으로 보내는 redirect 뿐이다'),
  'fw/legacy/[surveyId]/page.tsx': exempt('옛 주소 다리 비밀번호 화면 — 열린 외주 링크 유무만 보고 링크 콘솔로 보낸다'),

  // 03 — 조사 대상 목록·필터 후보·검색
  'fw/[token]/operations/contacts/page.tsx': FILTERED,

  // 05 — 단건 상세
  'fw/[token]/operations/contacts/[contactId]/page.tsx': FILTERED,

  // 06 — 응답 내역·상세 수정
  'fw/[token]/operations/profiles/page.tsx': FILTERED,
  'fw/[token]/operations/profiles/[responseId]/edit/page.tsx': FILTERED,

  // 07 — 응답 현황(응답 수)·진척 보고
  'fw/[token]/operations/overview/page.tsx#응답 수': FILTERED,
  'fw/[token]/operations/report/page.tsx': FILTERED,

  // 08 — 쿼터 현황(응답 현황 화면의 쿼터 조각 포함 — 오케스트레이터 결정)
  'fw/[token]/operations/overview/page.tsx#쿼터': pending('08'),
  'fw/[token]/operations/quota/page.tsx': pending('08'),
};
