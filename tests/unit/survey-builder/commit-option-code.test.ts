import { describe, expect, it } from 'vitest';
import { commitOptionCode, hasOptionCodeConflict } from '@/utils/option-code-generator';

const opts = () => [
  { id: 'a', value: 'option-1', optionCode: '1', isCustomOptionCode: true },
  { id: 'b', value: 'option-2' },
];

describe('hasOptionCodeConflict', () => {
  it('다른 옵션의 optionCode와 겹치면 true', () => {
    expect(hasOptionCodeConflict(opts(), 1, '1')).toBe(true);
  });

  it('다른 옵션의 value와 겹치면 true', () => {
    expect(hasOptionCodeConflict(opts(), 1, 'option-1')).toBe(true);
  });

  it('유일한 코드면 false', () => {
    expect(hasOptionCodeConflict(opts(), 1, '5')).toBe(false);
  });

  it('빈 코드는 항상 false', () => {
    expect(hasOptionCodeConflict(opts(), 1, '')).toBe(false);
  });

  it('자기 자신과의 일치는 충돌로 보지 않는다', () => {
    expect(hasOptionCodeConflict(opts(), 0, '1')).toBe(false);
  });
});

describe('commitOptionCode', () => {
  it('유일한 코드는 conflict=false, valueChange 를 반환한다', () => {
    const r = commitOptionCode(opts(), 1, '5');
    expect(r.conflict).toBe(false);
    expect(r.valueChange).toEqual({ oldValue: 'option-2', newValue: '5' });
    expect(r.options[1]).toMatchObject({ optionCode: '5', value: '5' });
  });

  it('충돌하는 코드는 conflict=true, valueChange=null 이고 optionCode만 반영한다', () => {
    const r = commitOptionCode(opts(), 1, '1');
    expect(r.conflict).toBe(true);
    expect(r.valueChange).toBeNull();
    expect(r.options[1]).toMatchObject({ optionCode: '1', value: 'option-2' });
  });

  it('빈 코드는 conflict=false 로 자동 발번 상태로 되돌린다', () => {
    const r = commitOptionCode(opts(), 0, '');
    expect(r.conflict).toBe(false);
    expect(r.valueChange).toBeNull();
    expect(r.options[0]!.optionCode).toBeUndefined();
  });

  it('자기 현재 값과 같은 코드를 재입력하면 conflict=false, valueChange=null', () => {
    const r = commitOptionCode(opts(), 1, 'option-2');
    expect(r.conflict).toBe(false);
    expect(r.valueChange).toBeNull();
  });
});
