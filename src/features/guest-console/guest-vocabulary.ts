import { formatLocalDate } from '@/lib/date-formatters';
import {
  type ClientLinkTabs,
  SURVEY_GUEST_TAB_LABEL,
  type SurveyGuestTab,
  type SurveyGuestTabs,
  surveyGuestTabValues,
} from '@/shared/contracts/workspace';
import type { GuestSurveyLifecycle } from '@/shared/contracts/workspace-io';

/**
 * 게스트 콘솔의 어휘와 주소 (.pen FLOW 5-2·5-3, 역할 모델 v2 티켓 22).
 *
 * 탭 라벨은 공유 어휘(`SURVEY_GUEST_TAB_LABEL`)를 그대로 쓴다 — 공유 설정 모달의 체크박스와
 * 게스트가 보는 탭이 같은 말이어야 「체크한 것이 열린다」가 눈으로 확인된다.
 */

/** 진행 상태 표기 — 서버는 판별자만 주고 문구는 화면이 정한다. */
export const GUEST_SURVEY_LIFECYCLE_LABEL: Record<GuestSurveyLifecycle, string> = {
  draft: '미발행',
  running: '진행중',
  paused: '일시중지',
  closed: '종료',
};

/**
 * 탭 → 주소 조각.
 *
 * 라우트 세그먼트를 어휘 옆에 두는 이유는 탭이 늘 때 **한 자리만** 고치기 위해서다 —
 * 카드의 「현황 보기」, 열람 화면의 탭 바, 페이지 파일 이름이 같은 값을 보게 된다.
 */
export const GUEST_TAB_SEGMENT: Record<SurveyGuestTab, string> = {
  overview: 'overview',
  progressReport: 'report',
  contactsMasked: 'contacts',
  quota: 'quota',
};

/** 설문지 미리보기 — 화이트리스트 밖이라 부여된 설문이면 언제나 열린다(스펙 §5 「보는 것 ①」). */
export const GUEST_PREVIEW_SEGMENT = 'preview';
export const GUEST_PREVIEW_LABEL = '설문 미리보기';

export interface GuestTabLink {
  segment: string;
  label: string;
}

/** 이 설문에서 열린 현황 탭 — 어휘가 정한 순서 그대로. */
export function allowedGuestTabs(tabs: SurveyGuestTabs): GuestTabLink[] {
  return surveyGuestTabValues
    .filter((tab) => tabs[tab])
    .map((tab) => ({ segment: GUEST_TAB_SEGMENT[tab], label: SURVEY_GUEST_TAB_LABEL[tab] }));
}

/**
 * 카드의 「현황 보기」가 여는 첫 탭 — 열린 것이 없으면 null.
 *
 * 허용 탭이 하나도 없는 부여도 만들 수 있다(체크를 전부 끄면 된다). 그때 카드는 미리보기만
 * 남고 「현황 보기」는 그리지 않는다 — 눌러도 404 인 버튼을 두지 않는다.
 */
export function firstGuestTabSegment(tabs: SurveyGuestTabs): string | null {
  return allowedGuestTabs(tabs)[0]?.segment ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 주소 — 접두는 입구가 정한다 (ADR-0029)
// ─────────────────────────────────────────────────────────────────────────────
//
// 같은 화면을 두 입구가 연다: 계정(`/guest/surveys/<id>`)과 클라이언트 링크(`/client/<token>`).
// 화면은 자기 접두를 모르고 주입받는다 — 접두를 화면 안에 적으면 링크로 들어온 클라이언트의
// 탭이 계정 주소로 나가 로그인 화면에 떨어진다. 운영 콘솔의 `operationsPaths(base)` 와 같은
// 방식이다.

/** 계정 입구의 접두 — 부여받은 설문 하나의 열람 화면. */
export function guestAccountSurveyBase(surveyId: string): string {
  return `/guest/surveys/${surveyId}`;
}

/** 접두 아래 화면 하나의 주소. */
export function guestConsoleHref(base: string, segment: string): string {
  return `${base}/${segment}`;
}

/**
 * 탭 없는 주소의 착지점 — 허용된 첫 탭, 없으면 미리보기.
 *
 * 카드의 「현황 보기」와 접속 직후의 이동이 같은 규칙을 쓴다. 허용 탭이 하나도 없는 부여·링크도
 * 만들 수 있으므로(체크를 전부 끄면 된다) 그때 갈 곳은 화이트리스트 밖의 미리보기다.
 */
export function guestConsoleEntryHref(base: string, tabs: SurveyGuestTabs): string {
  return guestConsoleHref(base, firstGuestTabSegment(tabs) ?? GUEST_PREVIEW_SEGMENT);
}

/**
 * 클라이언트 링크 콘솔의 「열린 화면이 없습니다」 안내 — 설문 보기까지 꺼진 링크의 착지점.
 *
 * 설문 보기가 칩이 된 뒤로는 탭을 전부 끈 링크에 갈 곳이 없을 수 있다. 미리보기로 보내면
 * 404 이고, 클라이언트는 「링크가 죽었다」로 읽는다 — 셸 안에서 그 사실을 말한다.
 */
export const CLIENT_EMPTY_SEGMENT = 'empty';

/**
 * 클라이언트 링크의 착지 주소 — 허용된 첫 탭, 없으면 설문 보기(켜져 있을 때만), 그것도
 * 없으면 빈 안내. 게스트 계정 입구(`guestConsoleEntryHref`)는 설문 보기가 칩이 아니라 늘 미리보기다.
 */
export function clientConsoleEntryHref(base: string, tabs: ClientLinkTabs): string {
  const segment =
    firstGuestTabSegment(tabs) ?? (tabs.preview ? GUEST_PREVIEW_SEGMENT : CLIENT_EMPTY_SEGMENT);
  return guestConsoleHref(base, segment);
}

/**
 * 카드·서브헤더의 기간 표기 — `2026. 08. 10. ~ 2026. 09. 05.` (.pen 5-2).
 *
 * 날짜는 공용 포매터(`formatLocalDate`)가 만든다 — **KST 고정**이 이 레포의 원칙이고
 * (date-formatters 헤더), 이 함수는 서버 컴포넌트(홈 카드)와 클라이언트 컴포넌트
 * (열람 서브헤더) 양쪽에서 불린다. 자체 Intl 을 쓰면 UTC 호스트에서 SSR 이 하루 앞 날짜를
 * 박고 클라이언트 재렌더가 그것을 다른 값으로 바꾼다.
 */
export function guestPeriodLabel(publishedAt: Date | null, endDate: Date | null): string {
  const start = publishedAt ? formatLocalDate(publishedAt) : '발행 전';
  const end = endDate ? formatLocalDate(endDate) : '마감일 없음';
  return `${start} ~ ${end}`;
}
