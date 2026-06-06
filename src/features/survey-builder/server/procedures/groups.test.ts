import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/question-groups.service', async () => {
  const actual = await vi.importActual<
    typeof import('../services/question-groups.service')
  >('../services/question-groups.service');
  return {
    ...actual,
    createQuestionGroup: vi.fn(),
    updateQuestionGroup: vi.fn(),
    deleteQuestionGroup: vi.fn(),
    reorderGroups: vi.fn(),
  };
});

import * as svc from '../services/question-groups.service';
import { groups } from './groups';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';
const GROUP_ID = '44444444-4444-4444-8444-444444444444';
const GROUP_ID_2 = '55555555-5555-4555-8555-555555555555';

describe('surveyBuilder.groups procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('create는 service.createQuestionGroup에 위임하고 행을 반환한다', async () => {
    const row = { id: GROUP_ID, surveyId: SURVEY_ID, name: 'G1', order: 0 };
    vi.mocked(svc.createQuestionGroup).mockResolvedValue(row as never);
    const client = createRouterClient({ groups }, { context: authedContext() });
    const input = { surveyId: SURVEY_ID, name: 'G1' };
    const res = await client.groups.create(input);
    expect(svc.createQuestionGroup).toHaveBeenCalledWith(input);
    expect(res).toEqual(row);
  });

  it('update는 service.updateQuestionGroup에 (groupId, data)로 위임한다', async () => {
    const row = { id: GROUP_ID, surveyId: SURVEY_ID, name: 'G1-edit', order: 0 };
    vi.mocked(svc.updateQuestionGroup).mockResolvedValue(row as never);
    const client = createRouterClient({ groups }, { context: authedContext() });
    const res = await client.groups.update({
      groupId: GROUP_ID,
      data: { name: 'G1-edit', parentGroupId: null },
    });
    expect(svc.updateQuestionGroup).toHaveBeenCalledWith(GROUP_ID, {
      name: 'G1-edit',
      parentGroupId: null,
    });
    expect(res).toEqual(row);
  });

  it('remove는 service.deleteQuestionGroup에 위임하고 {ok:true}를 반환한다', async () => {
    vi.mocked(svc.deleteQuestionGroup).mockResolvedValue({ ok: true } as never);
    const client = createRouterClient({ groups }, { context: authedContext() });
    const res = await client.groups.remove({ groupId: GROUP_ID });
    expect(svc.deleteQuestionGroup).toHaveBeenCalledWith(GROUP_ID);
    expect(res).toEqual({ ok: true });
  });

  it('reorder는 service.reorderGroups에 (surveyId, groupIds)로 위임한다', async () => {
    vi.mocked(svc.reorderGroups).mockResolvedValue({ ok: true } as never);
    const client = createRouterClient({ groups }, { context: authedContext() });
    const ids = [GROUP_ID, GROUP_ID_2];
    const res = await client.groups.reorder({ surveyId: SURVEY_ID, groupIds: ids });
    expect(svc.reorderGroups).toHaveBeenCalledWith(SURVEY_ID, ids);
    expect(res).toEqual({ ok: true });
  });

  it('인증 없으면 create가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { groups },
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(
      client.groups.create({ surveyId: SURVEY_ID, name: 'G1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
