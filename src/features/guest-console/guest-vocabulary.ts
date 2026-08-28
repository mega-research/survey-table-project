import {
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

/** 카드·서브헤더의 기간 표기 — `2026. 08. 10. ~ 2026. 09. 05.` (.pen 5-2). */
export function guestPeriodLabel(publishedAt: Date | null, endDate: Date | null): string {
  const start = publishedAt ? formatDay(publishedAt) : '발행 전';
  const end = endDate ? formatDay(endDate) : '마감일 없음';
  return `${start} ~ ${end}`;
}

/** `2026. 08. 10.` — 한국어 표기의 점 세 개. */
function formatDay(value: Date): string {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}
