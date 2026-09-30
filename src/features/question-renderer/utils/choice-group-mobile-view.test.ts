import { describe, expect, it } from 'vitest';

import {
  resolveChoiceGroupMobileView,
  withChoiceGroupMobileView,
} from '@/features/question-renderer/utils/choice-group-mobile-view';
import type { ChoiceGroup } from '@/types/survey';

const base: ChoiceGroup = { id: 'g', groupKey: 'rad1', type: 'radio', label: '만족도' };

describe('resolveChoiceGroupMobileView', () => {
  it('아무것도 없으면 세로 타일, 원본 한 줄·척도 막대는 각 필드', () => {
    expect(resolveChoiceGroupMobileView(base)).toBe('tiles');
    expect(resolveChoiceGroupMobileView({ ...base, mobileOriginalLine: true })).toBe(
      'original-line',
    );
    expect(resolveChoiceGroupMobileView({ ...base, mobileScaleBar: true })).toBe('scale-bar');
    expect(resolveChoiceGroupMobileView(undefined)).toBe('tiles');
  });

  it('둘 다 켜진 어긋난 값은 척도 막대로 읽는다', () => {
    expect(
      resolveChoiceGroupMobileView({ ...base, mobileOriginalLine: true, mobileScaleBar: true }),
    ).toBe('scale-bar');
  });

  it('순위 그룹은 언제나 세로 타일', () => {
    expect(resolveChoiceGroupMobileView({ ...base, type: 'ranking', mobileScaleBar: true })).toBe(
      'tiles',
    );
  });
});

describe('withChoiceGroupMobileView', () => {
  it('둘 중 하나만 남기거나 둘 다 지운다', () => {
    const both = { ...base, mobileOriginalLine: true, mobileScaleBar: true } as ChoiceGroup;
    expect(withChoiceGroupMobileView(both, 'scale-bar')).toEqual({ ...base, mobileScaleBar: true });
    expect(withChoiceGroupMobileView(both, 'original-line')).toEqual({
      ...base,
      mobileOriginalLine: true,
    });
    expect(withChoiceGroupMobileView(both, 'tiles')).toEqual(base);
  });
});
