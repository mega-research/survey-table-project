import { describe, expect, it } from 'vitest';

import {
  FILTER_SOURCE,
  LINK_CLICK_FILTER_OPTIONS,
  LINK_CLICK_FILTER_VALUES,
  MAIL_FILTER_VALUES,
  WEB_FILTER_VALUES,
  defaultFilterValueForSource,
  linkClickLabel,
} from './filter-shared';

describe('defaultFilterValueForSource — 값 선택 상자 열의 기본값', () => {
  it('선택 상자로 고르는 열은 화면에 처음 보이는 선택지를 기본값으로 준다', () => {
    // 빈 값이면 화면에는 선택지가 골라진 것처럼 보이는데 조건은 전송 전에 버려진다.
    expect(defaultFilterValueForSource(FILTER_SOURCE.WEB)).toBe('completed');
    expect(defaultFilterValueForSource(FILTER_SOURCE.EMAIL)).toBe('delivered');
    expect(defaultFilterValueForSource(FILTER_SOURCE.LINK_CLICK)).toBe('not_clicked');
  });

  it('기본값은 그 열의 필터가 받는 값이다', () => {
    expect(WEB_FILTER_VALUES.has(defaultFilterValueForSource(FILTER_SOURCE.WEB))).toBe(true);
    expect(MAIL_FILTER_VALUES.has(defaultFilterValueForSource(FILTER_SOURCE.EMAIL))).toBe(true);
    expect(LINK_CLICK_FILTER_VALUES.has(defaultFilterValueForSource(FILTER_SOURCE.LINK_CLICK))).toBe(
      true,
    );
  });

  it('글자로 적는 열은 비워 둔다', () => {
    expect(defaultFilterValueForSource(FILTER_SOURCE.RESID)).toBe('');
    expect(defaultFilterValueForSource('attrs.회사명')).toBe('');
    expect(defaultFilterValueForSource(FILTER_SOURCE.CONTACT_RESULT)).toBe('');
  });
});

describe('링크 클릭 필터 선택지', () => {
  it('「없음」과 「발송 이력 없음」이 글자로 구분된다', () => {
    expect(LINK_CLICK_FILTER_OPTIONS.map((o) => o.label)).toEqual([
      '있음',
      '없음',
      '— (발송 이력 없음)',
    ]);
  });

  it('칸에 보이는 글자와 선택지 글자가 같다', () => {
    expect(linkClickLabel('clicked')).toBe('있음');
    expect(linkClickLabel('not_clicked')).toBe('없음');
    expect(linkClickLabel(null)).toBe('');
  });
});
