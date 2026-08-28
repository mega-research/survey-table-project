import { createRouterClient, ORPCError } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/contact-attempts', () => ({
  addAttempt: vi.fn(),
  updateAttempt: vi.fn(),
  deleteAttempt: vi.fn(),
}));

vi.mock('@/server/rpc-survey-access', () => ({ assertScopedSurveyCapabilityRpc: vi.fn() }));

import { assertScopedSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import * as svc from '../services/contact-attempts';
import { attempts } from './attempts';

function authedContext(): ORPCContext {
  return { db: {} as never, user: { id: 'admin-1', email: 'a@b.com', name: '관리자', status: 'active', isSuperadmin: false , userType: 'internal'} };
}

describe('attempts procedures', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it('add는 입력을 service.addAttempt에 위임하고 결과를 반환한다', async () => {
    vi.mocked(svc.addAttempt).mockResolvedValue({ id: 'att-1', attemptNo: 1 } as never);
    const context = authedContext();
    const client = createRouterClient({ contacts: { attempts } }, { context });
    const input = { contactTargetId: 'ct-1', surveyId: 's-1', resultCode: '1.조사완료', note: '메모' };
    const res = await client.contacts.attempts.add(input);
    expect(assertScopedSurveyCapabilityRpc).toHaveBeenCalledWith(
      context.user,
      's-1',
      'contacts.writeAttempts',
    );
    expect(svc.addAttempt).toHaveBeenCalledWith(input, false);
    expect(res).toEqual({ id: 'att-1', attemptNo: 1 });
  });

  it('update는 입력을 service.updateAttempt에 위임하고 ok를 반환한다', async () => {
    vi.mocked(svc.updateAttempt).mockResolvedValue(undefined as never);
    const context = authedContext();
    const client = createRouterClient({ contacts: { attempts } }, { context });
    const input = { id: 'att-1', contactTargetId: 'ct-1', surveyId: 's-1', resultCode: '6.거절' };
    const res = await client.contacts.attempts.update(input);
    expect(assertScopedSurveyCapabilityRpc).toHaveBeenCalledWith(
      context.user,
      's-1',
      'contacts.writeAttempts',
    );
    expect(svc.updateAttempt).toHaveBeenCalledWith(input, false);
    expect(res).toEqual({ ok: true });
  });

  it('remove는 입력을 service.deleteAttempt에 위임하고 ok를 반환한다', async () => {
    vi.mocked(svc.deleteAttempt).mockResolvedValue(undefined as never);
    const context = authedContext();
    const client = createRouterClient({ contacts: { attempts } }, { context });
    const input = { surveyId: 's-1', contactTargetId: 'ct-1', id: 'att-1' };
    const res = await client.contacts.attempts.remove(input);
    expect(assertScopedSurveyCapabilityRpc).toHaveBeenCalledWith(
      context.user,
      's-1',
      'contacts.writeAttempts',
    );
    expect(svc.deleteAttempt).toHaveBeenCalledWith(input, false);
    expect(res).toEqual({ ok: true });
  });

  it('타 팀 설문 id 로 add 하면 NOT_FOUND — 서비스에 닿지 않는다', async () => {
    vi.mocked(assertScopedSurveyCapabilityRpc).mockRejectedValueOnce(
      new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' }),
    );
    const client = createRouterClient({ contacts: { attempts } }, { context: authedContext() });
    await expect(
      client.contacts.attempts.add({
        contactTargetId: 'ct-1',
        surveyId: 's-1',
        resultCode: '1.조사완료',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(svc.addAttempt).not.toHaveBeenCalled();
  });

  it('인증 없으면 add가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { contacts: { attempts } },
      { context: { db: {} as never, user: null } },
    );
    await expect(
      client.contacts.attempts.add({
        contactTargetId: 'ct-1',
        surveyId: 's-1',
        resultCode: '1.조사완료',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  // 관문(mock)이 통과시킨 뒤에도 서비스로 넘어가는 **파티션 플래그**는 계정 유형에서 나온다
  // (티켓 21 — 예전에는 env grant 목록을 다시 읽었다). 실제 게스트 계정은 이 표면의
  // capability(contacts.writeAttempts)를 갖지 못해 관문에서 막힌다.
  it('게스트 계정이면 실데이터 파티션 플래그가 서비스로 전달된다', async () => {
    vi.mocked(svc.addAttempt).mockResolvedValue({ id: 'att-1', attemptNo: 1 } as never);
    const client = createRouterClient(
      { contacts: { attempts } },
      { context: { db: {} as never, user: { id: 'guest-1', email: 'g@b.com', name: '게스트', status: 'active', isSuperadmin: false, userType: 'guest' } } },
    );
    const input = {
      contactTargetId: 'ct-1',
      surveyId: 's-1',
      resultCode: '1.조사완료',
    };
    const res = await client.contacts.attempts.add(input);
    expect(svc.addAttempt).toHaveBeenCalledWith(input, true);
    expect(res).toEqual({ id: 'att-1', attemptNo: 1 });
  });
});
