import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import * as route from '@/app/api/webhooks/resend/route';

describe('Resend webhook Next route exports', () => {
  it('Next가 허용하는 POST handler만 export한다', () => {
    expect(Object.keys(route).sort()).toEqual(['POST']);
  });
});
