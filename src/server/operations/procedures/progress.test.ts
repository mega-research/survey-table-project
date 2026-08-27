import { createRouterClient, ORPCError } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('@/server/rpc-survey-access', () => ({ assertSurveyCapabilityRpc: vi.fn() }));

vi.mock('../services/progress', async () => {
  const actual = await vi.importActual<
    typeof import('../services/progress')
  >('../services/progress');
  return {
    ...actual,
    updateProgressColumns: vi.fn(),
  };
});

import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import * as svc from '../services/progress';
import { progress } from './progress';

function authedContext(): ORPCContext {
  return { db: {} as never, user: { id: 'admin-1', email: 'a@b.com', name: '관리자', status: 'active', isSuperadmin: false , userType: 'internal'} };
}

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';

function scheme() {
  return { version: 1, columns: [{ key: 'month', label: '개최 월', order: 0 }] };
}

describe('operations.progress procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updateColumns는 입력을 service에 위임하고 {ok:true}를 반환한다', async () => {
    vi.mocked(svc.updateProgressColumns).mockResolvedValue({ ok: true } as never);
    const context = authedContext();
    const client = createRouterClient({ progress }, { context });
    const input = { surveyId: SURVEY_ID, scheme: scheme() };
    const res = await client.progress.updateColumns(input);
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledWith(
      context.user,
      SURVEY_ID,
      'survey.edit',
    );
    expect(svc.updateProgressColumns).toHaveBeenCalledWith(input);
    expect(res).toEqual({ ok: true });
  });

  it('타 팀 설문 id 면 NOT_FOUND — 서비스에 닿지 않는다', async () => {
    vi.mocked(assertSurveyCapabilityRpc).mockRejectedValueOnce(
      new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' }),
    );
    const client = createRouterClient({ progress }, { context: authedContext() });
    await expect(
      client.progress.updateColumns({ surveyId: SURVEY_ID, scheme: scheme() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(svc.updateProgressColumns).not.toHaveBeenCalled();
  });

  it('검증 실패 {ok:false,error}는 throw 없이 그대로 통과한다', async () => {
    vi.mocked(svc.updateProgressColumns).mockResolvedValue({
      ok: false,
      error: '컬럼 키가 중복되었습니다.',
    } as never);
    const client = createRouterClient({ progress }, { context: authedContext() });
    const res = await client.progress.updateColumns({ surveyId: SURVEY_ID, scheme: scheme() });
    expect(res).toEqual({ ok: false, error: '컬럼 키가 중복되었습니다.' });
  });

  it('인증 없으면 updateColumns가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { progress },
      { context: { db: {} as never, user: null } },
    );
    await expect(
      client.progress.updateColumns({ surveyId: SURVEY_ID, scheme: scheme() }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
