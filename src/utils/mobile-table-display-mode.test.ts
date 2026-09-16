import { describe, expect, it } from 'vitest';

import {
  MOBILE_TABLE_DISPLAY_MODES,
  type MobileTableDisplayMode,
} from '@/types/mobile-table-display';
import {
  clampMobileDrilldownOmitLeadingColumns,
  resolveMobileTableDisplayMode,
} from '@/utils/mobile-table-display-mode';

describe('MOBILE_TABLE_DISPLAY_MODES', () => {
  // 어휘 SSOT 를 못박는다 — 이 배열 하나가 zod enum 3곳(server/survey-builder/domain/question.ts 2 ·
  // lib/question/schema.ts 1)·Drizzle 컬럼 타입·아래 폴백 판정의 유효값을 만든다.
  // 단 DB CHECK 는 여기서 파생되지 않는다 — Drizzle 의 text(..., { enum }) 는 타입 전용이라 SQL 을
  // 만들지 않는다. 같은 목록을 손으로 다시 쓴 사본이 **둘** 있다: 실제 제약을 만드는
  // supabase/migrations (DROP 후 리터럴 목록으로 다시 ADD, 현행 0108_add_axis_cards_mobile_mode.sql)
  // 와 db/schema/surveys.ts 의 questions_mobile_table_display_mode_check. 어휘를 늘리면 셋을 함께
  // 고쳐야 하고, 배열만 고쳐 배포하면 새 값을 담은 questions 쓰기가 CHECK 제약에서 깨진다.
  it('표시 방식 어휘 7종을 담는다', () => {
    expect(MOBILE_TABLE_DISPLAY_MODES).toEqual([
      'auto',
      'drilldown-original-row',
      'row-wise-original',
      'row-cards',
      'row-group-cards',
      'axis-cards',
      'original',
    ]);
  });
});

// 케이스를 어휘 배열에서 뽑아 모드가 늘어도 빠짐없이 돈다. legacy 플래그 두 값을 모두 도는 것은
// 폴백 결과와 겹치는 모드 때문이다 — legacy=true 면 폴백이 'original', false 면 'auto' 라
// 한쪽만 돌리면 그 모드가 isMobileTableDisplayMode 에서 빠져도 폴백 값이 같아 초록이 된다.
const validEnumCases = MOBILE_TABLE_DISPLAY_MODES.flatMap(
  (mode): Array<[MobileTableDisplayMode, boolean]> => [
    [mode, true],
    [mode, false],
  ],
);

describe('resolveMobileTableDisplayMode', () => {
  it.each(validEnumCases)('유효 enum %s는 legacy %s와 무관하게 정본으로 사용', (mode, legacy) => {
    expect(resolveMobileTableDisplayMode({
      mobileTableDisplayMode: mode,
      mobileOriginalTable: legacy,
    })).toBe(mode);
  });

  it('enum 키가 없는 과거 snapshot은 legacy true를 original로 복원', () => {
    expect(resolveMobileTableDisplayMode({ mobileOriginalTable: true })).toBe('original');
  });

  it('유효하지 않은 enum은 legacy boolean 후 auto 순서로 폴백', () => {
    expect(resolveMobileTableDisplayMode({ mobileTableDisplayMode: 'bad', mobileOriginalTable: true }))
      .toBe('original');
    expect(resolveMobileTableDisplayMode({ mobileTableDisplayMode: 'bad' })).toBe('auto');
  });
});

describe('clampMobileDrilldownOmitLeadingColumns', () => {
  it.each([
    [undefined, 11, 1],
    [0, 11, 0],
    [2, 11, 2],
    [99, 11, 10],
    [-2, 11, 0],
    [1.8, 11, 1],
    [1, 1, 0],
    [1, 0, 0],
  ])('값 %s, 열 %s개를 %s로 정규화', (value, count, expected) => {
    expect(clampMobileDrilldownOmitLeadingColumns(value, count)).toBe(expected);
  });
});
