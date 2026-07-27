import { createRouterClient } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/contact-attempts.service', () => ({
  addAttempt: vi.fn(),
  updateAttempt: vi.fn(),
  deleteAttempt: vi.fn(),
}));

import * as svc from '../services/contact-attempts.service';
import { attempts } from './attempts';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

describe('attempts procedures', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it('add는 입력을 service.addAttempt에 위임하고 결과를 반환한다', async () => {
    vi.mocked(svc.addAttempt).mockResolvedValue({ id: 'att-1', attemptNo: 1 } as never);
    const client = createRouterClient({ contacts: { attempts } }, { context: authedContext() });
    const input = { contactTargetId: 'ct-1', surveyId: 's-1', resultCode: '1.조사완료', note: '메모' };
    const res = await client.contacts.attempts.add(input);
    expect(svc.addAttempt).toHaveBeenCalledWith(input);
    expect(res).toEqual({ id: 'att-1', attemptNo: 1 });
  });

  it('update는 입력을 service.updateAttempt에 위임하고 ok를 반환한다', async () => {
    vi.mocked(svc.updateAttempt).mockResolvedValue(undefined as never);
    const client = createRouterClient({ contacts: { attempts } }, { context: authedContext() });
    const input = { id: 'att-1', contactTargetId: 'ct-1', surveyId: 's-1', resultCode: '6.거절' };
    const res = await client.contacts.attempts.update(input);
    expect(svc.updateAttempt).toHaveBeenCalledWith(input);
    expect(res).toEqual({ ok: true });
  });

  it('remove는 입력을 service.deleteAttempt에 위임하고 ok를 반환한다', async () => {
    vi.mocked(svc.deleteAttempt).mockResolvedValue(undefined as never);
    const client = createRouterClient({ contacts: { attempts } }, { context: authedContext() });
    const input = { surveyId: 's-1', contactTargetId: 'ct-1', id: 'att-1' };
    const res = await client.contacts.attempts.remove(input);
    expect(svc.deleteAttempt).toHaveBeenCalledWith(input);
    expect(res).toEqual({ ok: true });
  });

  it('인증 없으면 add가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { contacts: { attempts } },
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(
      client.contacts.attempts.add({
        contactTargetId: 'ct-1',
        surveyId: 's-1',
        resultCode: '1.조사완료',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('게스트는 grant 설문이면 add 가 위임된다', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:s-1');
    vi.mocked(svc.addAttempt).mockResolvedValue({ id: 'att-1', attemptNo: 1 } as never);
    const client = createRouterClient(
      { contacts: { attempts } },
      { context: { db: {} as never, supabase: {} as never, user: { id: 'guest-1', email: 'g@b.com' } } },
    );
    const res = await client.contacts.attempts.add({
      contactTargetId: 'ct-1',
      surveyId: 's-1',
      resultCode: '1.조사완료',
    });
    expect(res).toEqual({ id: 'att-1', attemptNo: 1 });
  });

  it('게스트가 다른 설문 surveyId 로 add 하면 FORBIDDEN', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', 'guest-1:s-1');
    const client = createRouterClient(
      { contacts: { attempts } },
      { context: { db: {} as never, supabase: {} as never, user: { id: 'guest-1', email: 'g@b.com' } } },
    );
    await expect(
      client.contacts.attempts.add({
        contactTargetId: 'ct-1',
        surveyId: 's-other',
        resultCode: '1.조사완료',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(svc.addAttempt).not.toHaveBeenCalled();
  });
});
