import { createRouterClient, ORPCError } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/contact-assignments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/contact-assignments')>();
  return {
    ...actual,
    createAssignment: vi.fn(),
    setTargetAssignment: vi.fn(),
  };
});

vi.mock('@/server/read-models/contact-assignment-options', () => ({
  listAssignmentOptions: vi.fn(),
}));

vi.mock('@/server/data-scope', () => ({
  loadOperationsDataScope: vi.fn(),
}));

vi.mock('@/server/rpc-survey-access', () => ({ assertSurveyCapabilityRpc: vi.fn() }));

import { loadOperationsDataScope } from '@/server/data-scope';
import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';
import { listAssignmentOptions } from '@/server/read-models/contact-assignment-options';
import * as svc from '../services/contact-assignments';
import { assignments } from './assignments';

const SURVEY_ID = '00000000-0000-4000-8000-000000000001';
const TARGET_ID = '00000000-0000-4000-8000-0000000000aa';

function ctx(userId: string, userType: 'internal' | 'guest' | 'fieldwork' = 'internal'): ORPCContext {
  return {
    db: {} as never,
    user: {
      id: userId,
      email: 'a@b.com',
      name: '사용자',
      status: 'active',
      isSuperadmin: false,
      userType,
    },
  };
}

describe('contacts.assignments procedures', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it('list 는 이 세션의 파티션으로 컨택원을 읽는다', async () => {
    vi.mocked(loadOperationsDataScope).mockResolvedValue('test');
    vi.mocked(listAssignmentOptions).mockResolvedValue([{ id: 'a1', name: '10차', order: 1 }]);
    const client = createRouterClient({ assignments }, { context: ctx('admin-1') });
    const res = await client.assignments.list({ surveyId: SURVEY_ID });
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin-1' }),
      SURVEY_ID,
      'contacts.view',
    );
    expect(listAssignmentOptions).toHaveBeenCalledWith(SURVEY_ID, 'test');
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

  it('명단 관리 권한(contacts.manage)이 없으면 쓰기가 관문에서 막히고 서비스에 닿지 않는다', async () => {
    vi.mocked(assertSurveyCapabilityRpc).mockRejectedValueOnce(
      new ORPCError('FORBIDDEN', { message: '이 작업을 수행할 권한이 없습니다.' }),
    );
    const client = createRouterClient({ assignments }, { context: ctx('member-1') });
    await expect(
      client.assignments.create({ surveyId: SURVEY_ID, name: '10차' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'member-1' }),
      SURVEY_ID,
      'contacts.manage',
    );
    expect(svc.createAssignment).not.toHaveBeenCalled();
  });

  it('외부 계정(게스트·실사)은 모든 컨택원 procedure 가 FORBIDDEN', async () => {
    const client = createRouterClient({ assignments }, { context: ctx('guest-1', 'guest') });

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
    expect(listAssignmentOptions).not.toHaveBeenCalled();
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
