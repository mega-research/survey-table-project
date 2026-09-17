import { createRouterClient, ORPCError } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContactColumnScheme } from '@/shared/contracts/contacts';
import type { ORPCContext } from '@/server/context';

vi.mock('../services/contact-columns', () => ({
  updateContactColumns: vi.fn(),
  updateContactGroupLevels: vi.fn(),
  getExistingContactsCount: vi.fn(),
}));

vi.mock('@/server/rpc-survey-access', () => ({ assertSurveyCapabilityRpc: vi.fn() }));

import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import * as svc from '../services/contact-columns';
import { columns } from './columns';

function authedContext(): ORPCContext {
  return { db: {} as never, user: { id: 'admin-1', email: 'a@b.com', name: '관리자', status: 'active', isSuperadmin: false , userType: 'internal'} };
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
    const context = authedContext();
    const client = createRouterClient({ columns }, { context });
    const input = { surveyId: 'sv-1', scheme };
    const res = await client.columns.update(input);
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledWith(context.user, 'sv-1', 'contacts.manage');
    expect(svc.updateContactColumns).toHaveBeenCalledWith(input);
    expect(res).toEqual({ ok: true });
  });

  it('타 팀 설문 id 로 update 하면 NOT_FOUND — 서비스에 닿지 않는다', async () => {
    vi.mocked(assertSurveyCapabilityRpc).mockRejectedValueOnce(
      new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' }),
    );
    const client = createRouterClient({ columns }, { context: authedContext() });
    await expect(client.columns.update({ surveyId: 'sv-1', scheme })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(svc.updateContactColumns).not.toHaveBeenCalled();
  });

  it('인증 없으면 update가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { columns },
      { context: { db: {} as never, user: null } },
    );
    await expect(
      client.columns.update({ surveyId: 'sv-1', scheme }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('updateGroupLevels는 service에 위임하고 {ok:true}를 반환한다', async () => {
    vi.mocked(svc.updateContactGroupLevels).mockResolvedValue(undefined as never);
    const context = authedContext();
    const client = createRouterClient({ columns }, { context });
    const input = { surveyId: 'sv-1', levels: { '산업 분류': 1, '종사자 구간': 2 } };
    const res = await client.columns.updateGroupLevels(input);
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledWith(context.user, 'sv-1', 'contacts.manage');
    expect(svc.updateContactGroupLevels).toHaveBeenCalledWith(input);
    expect(res).toEqual({ ok: true });
  });

  it('updateGroupLevels는 레벨 범위(1..4) 밖 입력을 zod에서 거부한다', async () => {
    const client = createRouterClient({ columns }, { context: authedContext() });
    await expect(
      client.columns.updateGroupLevels({ surveyId: 'sv-1', levels: { 대분류: 5 } }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(svc.updateContactGroupLevels).not.toHaveBeenCalled();
  });

  it('인증 없으면 updateGroupLevels가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { columns },
      { context: { db: {} as never, user: null } },
    );
    await expect(
      client.columns.updateGroupLevels({ surveyId: 'sv-1', levels: {} }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
