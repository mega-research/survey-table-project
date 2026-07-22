import { describe, expect, it } from 'vitest';

import { testFlagForScope } from '@/lib/operations/data-scope.server';

describe('testFlagForScope', () => {
  it('real은 false, test는 true로 고정한다', () => {
    expect(testFlagForScope('real')).toBe(false);
    expect(testFlagForScope('test')).toBe(true);
  });
});
