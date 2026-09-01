import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

import * as svc from '../services/contact-id-lists.service';
import { idLists } from './id-lists';

vi.mock('../services/contact-id-lists.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/contact-id-lists.service')>();
  return {
    ...actual,
    createContactIdList: vi.fn(),
  };
});

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

const SURVEY_ID = '00000000-0000-4000-8000-000000000001';

describe('contacts.idLists procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('create 는 호출자 id 를 createdBy 로 붙여 service 에 위임하고 id·count 를 돌려준다', async () => {
    vi.mocked(svc.createContactIdList).mockResolvedValue({
      id: '0f3a4b5c-1111-4222-8333-444455556666',
      count: 2,
    });

    const client = createRouterClient({ idLists }, { context: authedContext() });
    const res = await client.idLists.create({ surveyId: SURVEY_ID, ids: [99, 292] });

    expect(res).toEqual({ id: '0f3a4b5c-1111-4222-8333-444455556666', count: 2 });
    expect(svc.createContactIdList).toHaveBeenCalledWith({
      surveyId: SURVEY_ID,
      ids: [99, 292],
      createdBy: 'admin-1',
    });
  });

  it('빈 목록은 입력 검증에서 거부한다', async () => {
    const client = createRouterClient({ idLists }, { context: authedContext() });
    await expect(client.idLists.create({ surveyId: SURVEY_ID, ids: [] })).rejects.toThrow();
    expect(svc.createContactIdList).not.toHaveBeenCalled();
  });
});
