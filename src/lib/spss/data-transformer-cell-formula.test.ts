import { describe, expect, it } from 'vitest';
import { transformTableCell } from '@/lib/spss/data-transformer';

describe('calc 셀 export 변환', () => {
  it('숫자 문자열을 number 로 변환한다', () => {
    expect(transformTableCell('calc', '1234.5')).toBe(1234.5);
  });
  it('빈 값·비숫자는 null', () => {
    expect(transformTableCell('calc', '')).toBeNull();
    expect(transformTableCell('calc', undefined)).toBeNull();
    expect(transformTableCell('calc', 'abc')).toBeNull();
  });
});
