import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/contact-targets.service', () => ({
  addContactTarget: vi.fn(),
  updateContactTarget: vi.fn(),
  deleteContactTarget: vi.fn(),
}));

import * as svc from '../services/contact-targets.service';
import { targets } from './targets';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

describe('contacts.targets procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('add는 입력을 service.addContactTarget에 위임하고 결과를 반환한다', async () => {
    vi.mocked(svc.addContactTarget).mockResolvedValue({ id: 'ct-1', resid: 42 } as never);
    const client = createRouterClient({ targets }, { context: authedContext() });
    const input = { surveyId: 'sv-1', attrs: { name: '홍길동' } };
    const res = await client.targets.add(input);
    expect(svc.addContactTarget).toHaveBeenCalledWith(input);
    expect(res).toEqual({ id: 'ct-1', resid: 42 });
  });

  it('update는 service.updateContactTarget에 위임하고 {ok:true}를 반환한다', async () => {
    vi.mocked(svc.updateContactTarget).mockResolvedValue(undefined as never);
    const client = createRouterClient({ targets }, { context: authedContext() });
    const input = { id: 'ct-1', surveyId: 'sv-1', attrs: { name: '수정' } };
    const res = await client.targets.update(input);
    expect(svc.updateContactTarget).toHaveBeenCalledWith(input);
    expect(res).toEqual({ ok: true });
  });

  it('remove는 id만 service.deleteContactTarget에 위임하고 {ok:true}를 반환한다', async () => {
    vi.mocked(svc.deleteContactTarget).mockResolvedValue(undefined as never);
    const client = createRouterClient({ targets }, { context: authedContext() });
    const res = await client.targets.remove({ surveyId: 'sv-1', id: 'ct-9' });
    expect(svc.deleteContactTarget).toHaveBeenCalledWith('ct-9');
    expect(res).toEqual({ ok: true });
  });

  it('인증 없으면 add가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { targets },
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(
      client.targets.add({ surveyId: 'sv-1', attrs: {} }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
