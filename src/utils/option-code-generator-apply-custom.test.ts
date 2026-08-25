import { describe, expect, it } from 'vitest';
import { applyCustomOptionCode } from '@/utils/option-code-generator';

const opts = () => [
  { value: 'option-1', optionCode: '1', isCustomOptionCode: true },
  { value: 'option-2' },
];

describe('applyCustomOptionCode', () => {
  it('유일한 코드는 optionCode와 value를 함께 갱신하고 변경 쌍을 반환한다', () => {
    const r = applyCustomOptionCode(opts(), 1, '5');
    expect(r.options[1]).toMatchObject({ optionCode: '5', isCustomOptionCode: true, value: '5' });
    expect(r.valueChange).toEqual({ oldValue: 'option-2', newValue: '5' });
  });

  it('다른 옵션의 optionCode와 충돌하면 value를 보류한다', () => {
    const r = applyCustomOptionCode(opts(), 1, '1');
    expect(r.options[1]).toMatchObject({ optionCode: '1', value: 'option-2' });
    expect(r.valueChange).toBeNull();
  });

  it('다른 옵션의 value와 충돌해도 value를 보류한다', () => {
    const r = applyCustomOptionCode(opts(), 1, 'option-1');
    expect(r.options[1]!.value).toBe('option-2');
    expect(r.valueChange).toBeNull();
  });

  it('빈 코드는 자동 발번 상태로 되돌리고 value를 유지한다', () => {
    const r = applyCustomOptionCode(opts(), 0, '');
    expect(r.options[0]).toMatchObject({ isCustomOptionCode: false, value: 'option-1' });
    expect(r.options[0]!.optionCode).toBeUndefined();
    expect(r.valueChange).toBeNull();
  });

  it('원본 배열을 변이하지 않는다', () => {
    const src = opts();
    applyCustomOptionCode(src, 1, '5');
    expect(src[1]!.value).toBe('option-2');
  });
});
