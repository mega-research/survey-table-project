import { createRouterClient } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/contact-assignments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/contact-assignments')>();
  return {
    ...actual,
    listAssignmentOptions: vi.fn(),
    createAssignment: vi.fn(),
    setTargetAssignment: vi.fn(),
  };
});

vi.mock('@/server/data-scope', () => ({
  loadOperationsDataScope: vi.fn(),
}));

import { loadOperationsDataScope } from '@/server/data-scope';
import * as svc from '../services/contact-assignments';
import { assignments } from './assignments';

const SURVEY_ID = '00000000-0000-4000-8000-000000000001';
const TARGET_ID = '00000000-0000-4000-8000-0000000000aa';

function ctx(userId: string): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: userId, email: 'a@b.com' } };
}

describe('contacts.assignments procedures', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it('list 는 이 세션의 파티션으로 컨택원을 읽는다', async () => {
    vi.mocked(loadOperationsDataScope).mockResolvedValue('test');
    vi.mocked(svc.listAssignmentOptions).mockResolvedValue([{ id: 'a1', name: '10차', order: 1 }]);
    const client = createRouterClient({ assignments }, { context: ctx('admin-1') });
    const res = await client.assignments.list({ surveyId: SURVEY_ID });
    expect(svc.listAssignmentOptions).toHaveBeenCalledWith(SURVEY_ID, 'test');
    expect(res).toEqual([{ id: 'a1', name: '10차', order: 1 }]);
  });

  it('같은 이름이면 DUPLICATE_NAME', async () => {
    vi.mocked(svc.createAssignment).mockRejectedValue(new svc.DuplicateAssignmentNameError('10차'));
    const client = createRouterClient({ assignments }, { context: ctx('admin-1') });
    await expect(
      client.assignments.create({ surveyId: SURVEY_ID, name: '10차' }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_NAME' });
  });

  it('이름 앞뒤 공백은 지우고, 빈 이름은 거부한다', async () => {
    vi.mocked(svc.createAssignment).mockResolvedValue({ id: 'a1', name: '10차', order: 1 });
    const client = createRouterClient({ assignments }, { context: ctx('admin-1') });
    await client.assignments.create({ surveyId: SURVEY_ID, name: '  10차 ' });
    expect(svc.createAssignment).toHaveBeenCalledWith({ surveyId: SURVEY_ID, name: '10차' });
    await expect(
      client.assignments.create({ surveyId: SURVEY_ID, name: '   ' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('게스트는 grant 설문이어도 모든 컨택원 procedure 가 FORBIDDEN', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', `guest-1:${SURVEY_ID}`);
    const client = createRouterClient({ assignments }, { context: ctx('guest-1') });

    await expect(client.assignments.list({ surveyId: SURVEY_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      client.assignments.create({ surveyId: SURVEY_ID, name: '10차' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      client.assignments.setTarget({
        surveyId: SURVEY_ID,
        contactTargetId: TARGET_ID,
        assignmentId: null,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    for (const call of [
      () => client.assignments.rename({ surveyId: SURVEY_ID, id: TARGET_ID, name: 'x' }),
      () => client.assignments.reorder({ surveyId: SURVEY_ID, ids: [TARGET_ID] }),
      () => client.assignments.remove({ surveyId: SURVEY_ID, id: TARGET_ID }),
      () =>
        client.assignments.preview({
          surveyId: SURVEY_ID,
          assignmentId: TARGET_ID,
          clauses: [{ source: 'system.resid', value: '1', op: '' }],
        }),
      () =>
        client.assignments.apply({
          surveyId: SURVEY_ID,
          assignmentId: TARGET_ID,
          clauses: [{ source: 'system.resid', value: '1', op: '' }],
        }),
      () => client.assignments.facets({ surveyId: SURVEY_ID, source: 'system.web' }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(svc.listAssignmentOptions).not.toHaveBeenCalled();
    expect(svc.createAssignment).not.toHaveBeenCalled();
    expect(svc.setTargetAssignment).not.toHaveBeenCalled();
  });

  it('교체 적용은 조건 줄 0개를 거부한다', async () => {
    const client = createRouterClient({ assignments }, { context: ctx('admin-1') });
    await expect(
      client.assignments.apply({ surveyId: SURVEY_ID, assignmentId: TARGET_ID, clauses: [] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('setTarget 은 배정 없음(null)도 그대로 넘긴다', async () => {
    vi.mocked(svc.setTargetAssignment).mockResolvedValue();
    const client = createRouterClient({ assignments }, { context: ctx('admin-1') });
    await client.assignments.setTarget({
      surveyId: SURVEY_ID,
      contactTargetId: TARGET_ID,
      assignmentId: null,
    });
    expect(svc.setTargetAssignment).toHaveBeenCalledWith({
      surveyId: SURVEY_ID,
      contactTargetId: TARGET_ID,
      assignmentId: null,
    });
  });
});
