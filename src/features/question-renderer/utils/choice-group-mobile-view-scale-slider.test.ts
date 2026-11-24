import { describe, expect, it } from 'vitest';

import type { ChoiceGroup } from '@/types/survey';

import {
  canChoiceGroupUseScaleSlider,
  resolveChoiceGroupMobileView,
  resolveChoiceGroupSliderDirection,
  withChoiceGroupMobileView,
} from './choice-group-mobile-view';

/**
 * 보기 모양의 네 번째 값 「척도 슬라이더」 — 읽기 우선순위(슬라이더 → 척도 막대 → 원본 한 줄 → 세로 타일)와
 * 쓰기의 배타(고른 모양의 필드만 남는다). 앞의 세 값은 옆 파일(choice-group-mobile-view.test.ts)이 본다.
 */

const base: ChoiceGroup = { id: 'g', groupKey: 'rad1', type: 'radio', label: '만족도' };

describe('resolveChoiceGroupMobileView — 척도 슬라이더', () => {
  it('슬라이더 방향이 적힌 라디오 묶음은 척도 슬라이더다', () => {
    expect(resolveChoiceGroupMobileView({ ...base, scaleSlider: 'positive-right' })).toBe(
      'scale-slider',
    );
    expect(resolveChoiceGroupMobileView({ ...base, scaleSlider: 'positive-left' })).toBe(
      'scale-slider',
    );
  });

  it('둘 이상 켜진 묶음도 우선순위대로 하나로 읽힌다 — 슬라이더가 가장 앞이다', () => {
    expect(
      resolveChoiceGroupMobileView({ ...base, scaleSlider: 'positive-left', mobileScaleBar: true }),
    ).toBe('scale-slider');
    expect(
      resolveChoiceGroupMobileView({
        ...base,
        scaleSlider: 'positive-right',
        mobileOriginalLine: true,
      }),
    ).toBe('scale-slider');
    expect(
      resolveChoiceGroupMobileView({
        ...base,
        scaleSlider: 'positive-right',
        mobileScaleBar: true,
        mobileOriginalLine: true,
      }),
    ).toBe('scale-slider');
  });

  it('순위·체크박스 묶음은 슬라이더가 될 수 없다 — 적혀 있어도 다음 순위의 모양으로 읽는다', () => {
    expect(
      resolveChoiceGroupMobileView({ ...base, type: 'ranking', scaleSlider: 'positive-right' }),
    ).toBe('tiles');
    expect(
      resolveChoiceGroupMobileView({ ...base, type: 'checkbox', scaleSlider: 'positive-right' }),
    ).toBe('tiles');
    expect(
      resolveChoiceGroupMobileView({
        ...base,
        type: 'checkbox',
        scaleSlider: 'positive-right',
        mobileScaleBar: true,
      }),
    ).toBe('scale-bar');
    expect(
      resolveChoiceGroupMobileView({
        ...base,
        type: 'checkbox',
        scaleSlider: 'positive-right',
        mobileOriginalLine: true,
      }),
    ).toBe('original-line');
  });

  it('어휘에 없는 값은 꺼진 것으로 읽는다', () => {
    for (const value of [true, 'right', '', null]) {
      const group = { ...base, scaleSlider: value } as unknown as ChoiceGroup;
      expect(resolveChoiceGroupMobileView(group)).toBe('tiles');
      expect(resolveChoiceGroupSliderDirection(group)).toBeNull();
    }
    expect(
      resolveChoiceGroupMobileView({
        ...base,
        scaleSlider: 'sideways',
        mobileScaleBar: true,
      } as unknown as ChoiceGroup),
    ).toBe('scale-bar');
  });
});

describe('resolveChoiceGroupSliderDirection', () => {
  it('슬라이더 묶음이면 그 방향, 아니면 null', () => {
    expect(resolveChoiceGroupSliderDirection({ ...base, scaleSlider: 'positive-left' })).toBe(
      'positive-left',
    );
    expect(resolveChoiceGroupSliderDirection({ ...base, scaleSlider: 'positive-right' })).toBe(
      'positive-right',
    );
    expect(resolveChoiceGroupSliderDirection(base)).toBeNull();
    expect(resolveChoiceGroupSliderDirection({ ...base, mobileScaleBar: true })).toBeNull();
    expect(resolveChoiceGroupSliderDirection(undefined)).toBeNull();
    expect(
      resolveChoiceGroupSliderDirection({ ...base, type: 'checkbox', scaleSlider: 'positive-left' }),
    ).toBeNull();
  });
});

describe('canChoiceGroupUseScaleSlider', () => {
  it('라디오 묶음만 슬라이더를 고를 수 있다', () => {
    expect(canChoiceGroupUseScaleSlider(base)).toBe(true);
    expect(canChoiceGroupUseScaleSlider({ ...base, type: 'checkbox' })).toBe(false);
    expect(canChoiceGroupUseScaleSlider({ ...base, type: 'ranking' })).toBe(false);
    expect(canChoiceGroupUseScaleSlider(undefined)).toBe(false);
  });
});

describe('withChoiceGroupMobileView — 척도 슬라이더', () => {
  it('슬라이더를 고르면 방향만 남고 다른 모양의 필드는 지워진다 — 기본은 오른쪽이 긍정', () => {
    const both = { ...base, mobileOriginalLine: true, mobileScaleBar: true } as ChoiceGroup;
    expect(withChoiceGroupMobileView(both, 'scale-slider')).toEqual({
      ...base,
      scaleSlider: 'positive-right',
    });
    expect(withChoiceGroupMobileView(base, 'scale-slider')).toEqual({
      ...base,
      scaleSlider: 'positive-right',
    });
  });

  it('방향을 주면 그 방향으로 적는다', () => {
    expect(withChoiceGroupMobileView(base, 'scale-slider', 'positive-left')).toEqual({
      ...base,
      scaleSlider: 'positive-left',
    });
    expect(
      withChoiceGroupMobileView(
        { ...base, scaleSlider: 'positive-left' },
        'scale-slider',
        'positive-right',
      ),
    ).toEqual({ ...base, scaleSlider: 'positive-right' });
  });

  it('슬라이더를 다시 고를 때 이미 있던 방향은 보존한다', () => {
    const left: ChoiceGroup = { ...base, scaleSlider: 'positive-left' };
    expect(withChoiceGroupMobileView(left, 'scale-slider')).toEqual(left);
  });

  it('슬라이더에서 다른 모양으로 가면 방향이 지워진다', () => {
    const slider: ChoiceGroup = { ...base, scaleSlider: 'positive-left' };
    expect(withChoiceGroupMobileView(slider, 'scale-bar')).toEqual({
      ...base,
      mobileScaleBar: true,
    });
    expect(withChoiceGroupMobileView(slider, 'original-line')).toEqual({
      ...base,
      mobileOriginalLine: true,
    });
    expect(withChoiceGroupMobileView(slider, 'tiles')).toEqual(base);
    // 다른 모양을 거쳐 돌아오면 지워졌던 방향은 기본으로 돌아온다
    expect(
      withChoiceGroupMobileView(withChoiceGroupMobileView(slider, 'tiles'), 'scale-slider'),
    ).toEqual({ ...base, scaleSlider: 'positive-right' });
  });

  it('네 값 사이를 오가도 묶음의 나머지 필드는 그대로다', () => {
    const rich: ChoiceGroup = {
      ...base,
      required: true,
      requiredMessage: '만족도를 골라 주세요',
      minSelections: 1,
      mobileScaleBarMiddleLabel: true,
      mobileScaleBar: true,
    };
    const { mobileScaleBar: _bar, ...kept } = rich;
    const slider = withChoiceGroupMobileView(rich, 'scale-slider', 'positive-left');
    expect(slider).toEqual({ ...kept, scaleSlider: 'positive-left' });
    expect(withChoiceGroupMobileView(slider, 'original-line')).toEqual({
      ...kept,
      mobileOriginalLine: true,
    });
    expect(withChoiceGroupMobileView(slider, 'scale-bar')).toEqual(rich);
    expect(withChoiceGroupMobileView(slider, 'tiles')).toEqual(kept);
  });

  it('순위·체크박스 묶음에 슬라이더를 쓰면 묶음은 그대로다', () => {
    const checkbox: ChoiceGroup = { ...base, type: 'checkbox', mobileScaleBar: true };
    expect(withChoiceGroupMobileView(checkbox, 'scale-slider')).toEqual(checkbox);
    expect(withChoiceGroupMobileView(checkbox, 'scale-slider', 'positive-left')).toEqual(checkbox);
    const ranking: ChoiceGroup = { ...base, type: 'ranking' };
    expect(withChoiceGroupMobileView(ranking, 'scale-slider')).toEqual(ranking);
  });

  it('어휘에 없는 방향이 적혀 있던 묶음을 슬라이더로 고르면 기본 방향으로 바로잡는다', () => {
    const broken = { ...base, scaleSlider: 'sideways' } as unknown as ChoiceGroup;
    expect(withChoiceGroupMobileView(broken, 'scale-slider')).toEqual({
      ...base,
      scaleSlider: 'positive-right',
    });
  });
});
