import { describe, expect, it } from 'vitest';

import {
  MOBILE_PIECE_COLUMNS_PER_VIEW_MAX,
  MOBILE_PIECE_COLUMNS_PER_VIEW_MIN,
} from '@/types/mobile-table-display';

import { CreateQuestionInput, UpdateQuestionData } from './question';

/**
 * 조각 좌우 반전 · 조각 한 화면 칸 수 — 문항 생성·수정 입력 스키마.
 *
 * 문항 최상위 키는 스키마에 없으면 zod 가 조용히 떨어뜨린다(값이 저장되지 않는데 오류도 없다).
 * 칸 수 범위는 어휘 상수(`@/types/mobile-table-display`)를 그대로 쓴다 — 범위 밖은 DB 까지 가지 않고 여기서 거부된다.
 */

const createBase = { surveyId: 's1', type: 'table' as const, title: '만족도' };

describe('문항 생성 입력 — 조각 표현 설정', () => {
  it('두 값을 떨어뜨리지 않고 받는다', () => {
    const parsed = CreateQuestionInput.parse({
      ...createBase,
      mobileDrilldownReverseColumns: true,
      mobileDrilldownColumnsPerView: 6,
    });
    expect(parsed.mobileDrilldownReverseColumns).toBe(true);
    expect(parsed.mobileDrilldownColumnsPerView).toBe(6);
  });

  it('없으면 없는 그대로다 — 꺼진 문항', () => {
    const parsed = CreateQuestionInput.parse(createBase);
    expect('mobileDrilldownReverseColumns' in parsed).toBe(false);
    expect('mobileDrilldownColumnsPerView' in parsed).toBe(false);
  });

  it.each([MOBILE_PIECE_COLUMNS_PER_VIEW_MIN - 1, MOBILE_PIECE_COLUMNS_PER_VIEW_MAX + 1, 4.5])(
    '범위 밖 칸 수 %s 는 거부한다',
    (count) => {
      expect(
        CreateQuestionInput.safeParse({ ...createBase, mobileDrilldownColumnsPerView: count })
          .success,
      ).toBe(false);
    },
  );
});

describe('문항 수정 입력 — 조각 표현 설정', () => {
  it('칸 수 null 은 「비움」이라 그대로 통과한다 — 싣지 않은 것(그대로 두기)과 구별된다', () => {
    expect(UpdateQuestionData.parse({ mobileDrilldownColumnsPerView: null })).toEqual({
      mobileDrilldownColumnsPerView: null,
    });
    expect('mobileDrilldownColumnsPerView' in UpdateQuestionData.parse({ title: '제목만' })).toBe(
      false,
    );
  });

  it('반전 false 는 「끄기」라 그대로 통과한다', () => {
    expect(UpdateQuestionData.parse({ mobileDrilldownReverseColumns: false })).toEqual({
      mobileDrilldownReverseColumns: false,
    });
  });

  it('범위 밖 칸 수는 거부한다', () => {
    expect(UpdateQuestionData.safeParse({ mobileDrilldownColumnsPerView: 7 }).success).toBe(false);
  });
});
