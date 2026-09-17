import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SURVEY_GUEST_TABS,
  NO_SURVEY_GUEST_TABS,
  SURVEY_GUEST_TAB_LABEL,
  surveyGuestTabValues,
} from '@/shared/contracts/workspace';

import {
  allowedGuestTabs,
  firstGuestTabSegment,
  GUEST_TAB_SEGMENT,
  guestPeriodLabel,
} from './guest-vocabulary';

/**
 * 게스트 콘솔의 어휘·주소 (역할 모델 v2 티켓 22).
 *
 * 화면 조각이 아니라 순수 함수만 본다 — 탭 바가 무엇을 그리고 카드가 어디로 링크하는지가
 * 전부 이 셋에서 나온다.
 */

describe('allowedGuestTabs — 열린 탭만, 어휘 순서대로', () => {
  it('꺼진 탭은 목록에 없다 — 비활성으로 그리지 않는다', () => {
    expect(allowedGuestTabs(DEFAULT_SURVEY_GUEST_TABS)).toEqual([
      { segment: 'overview', label: SURVEY_GUEST_TAB_LABEL.overview },
    ]);
  });

  it('전부 꺼져 있으면 빈 목록이다', () => {
    expect(allowedGuestTabs(NO_SURVEY_GUEST_TABS)).toEqual([]);
  });

  it('순서는 화면이 아니라 어휘가 정한다', () => {
    const all = allowedGuestTabs({
      overview: true,
      progressReport: true,
      contactsMasked: true,
      quota: true,
    });
    expect(all.map((tab) => tab.segment)).toEqual(
      surveyGuestTabValues.map((tab) => GUEST_TAB_SEGMENT[tab]),
    );
  });
});

describe('firstGuestTabSegment — 「현황 보기」가 여는 곳', () => {
  it('열린 것이 없으면 null — 눌러도 404 인 버튼을 만들지 않는다', () => {
    expect(firstGuestTabSegment(NO_SURVEY_GUEST_TABS)).toBeNull();
  });

  it('응답 현황이 꺼져 있어도 다음으로 열린 탭을 연다', () => {
    expect(
      firstGuestTabSegment({
        overview: false,
        progressReport: false,
        contactsMasked: true,
        quota: true,
      }),
    ).toBe(GUEST_TAB_SEGMENT.contactsMasked);
  });
});

describe('guestPeriodLabel — 기간 표기 (.pen 5-2)', () => {
  it('발행일 ~ 마감일', () => {
    const label = guestPeriodLabel(new Date('2026-08-10T00:00:00+09:00'), new Date('2026-09-05T00:00:00+09:00'));
    expect(label).toContain('~');
    expect(label).toMatch(/2026/);
  });

  it('미발행·마감일 없음은 문구로 말한다 — 빈 칸을 두지 않는다', () => {
    expect(guestPeriodLabel(null, null)).toBe('발행 전 ~ 마감일 없음');
  });
});
