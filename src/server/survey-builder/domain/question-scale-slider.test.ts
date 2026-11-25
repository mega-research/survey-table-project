import { describe, expect, it } from 'vitest';

import { SCALE_SLIDER_DIRECTIONS } from '@/types/scale-slider';

import { CreateQuestionInput, UpdateQuestionData } from './question';

/**
 * 문항의 슬라이더 방향 — 문항 생성·수정 입력 스키마.
 *
 * 문항 최상위 키는 스키마에 없으면 zod 가 조용히 떨어뜨린다(값이 저장되지 않는데 오류도 없다).
 * 값 목록은 어휘 배열(`@/types/scale-slider`)을 그대로 쓴다 — 모르는 값은 DB 까지 가지 않고 여기서 거부된다.
 */

const createBase = { surveyId: 's1', type: 'radio' as const, title: '추천 의향' };

describe('문항 생성 입력 — 슬라이더 방향', () => {
  it.each(SCALE_SLIDER_DIRECTIONS)('%s 를 떨어뜨리지 않고 받는다', (direction) => {
    const parsed = CreateQuestionInput.parse({ ...createBase, scaleSlider: direction });
    expect(parsed.scaleSlider).toBe(direction);
  });

  it('없으면 없는 그대로다 — 꺼진 문항', () => {
    expect('scaleSlider' in CreateQuestionInput.parse(createBase)).toBe(false);
  });

  it('null 을 받는다', () => {
    expect(CreateQuestionInput.parse({ ...createBase, scaleSlider: null }).scaleSlider).toBeNull();
  });

  it('어휘에 없는 값은 거부한다', () => {
    expect(CreateQuestionInput.safeParse({ ...createBase, scaleSlider: 'sideways' }).success).toBe(
      false,
    );
    expect(CreateQuestionInput.safeParse({ ...createBase, scaleSlider: true }).success).toBe(false);
  });
});

describe('문항 수정 입력 — 슬라이더 방향', () => {
  it.each(SCALE_SLIDER_DIRECTIONS)('%s 를 떨어뜨리지 않고 받는다', (direction) => {
    expect(UpdateQuestionData.parse({ scaleSlider: direction }).scaleSlider).toBe(direction);
  });

  it('null 은 「끄기」라 그대로 통과한다 — 싣지 않은 것(그대로 두기)과 구별된다', () => {
    expect(UpdateQuestionData.parse({ scaleSlider: null })).toEqual({ scaleSlider: null });
    expect('scaleSlider' in UpdateQuestionData.parse({ title: '제목만' })).toBe(false);
  });

  it('어휘에 없는 값은 거부한다', () => {
    expect(UpdateQuestionData.safeParse({ scaleSlider: 'positive-up' }).success).toBe(false);
  });
});
