import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContactColumnScheme } from '@/db/schema/schema-types';
import type { ORPCContext } from '@/server/context';

vi.mock('../services/contact-columns.service', () => ({
  updateContactColumns: vi.fn(),
  getExistingContactsCount: vi.fn(),
}));

import * as svc from '../services/contact-columns.service';
import { columns } from './columns';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

const scheme: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [{ key: 'resid', label: '번호', source: 'system.resid', order: 1 }],
};

describe('contacts.columns procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('update는 입력을 service.updateContactColumns에 위임하고 {ok:true}를 반환한다', async () => {
    vi.mocked(svc.updateContactColumns).mockResolvedValue(undefined as never);
    const client = createRouterClient({ columns }, { context: authedContext() });
    const input = { surveyId: 'sv-1', scheme };
    const res = await client.columns.update(input);
    expect(svc.updateContactColumns).toHaveBeenCalledWith(input);
    expect(res).toEqual({ ok: true });
  });

  it('인증 없으면 update가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { columns },
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(
      client.columns.update({ surveyId: 'sv-1', scheme }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
