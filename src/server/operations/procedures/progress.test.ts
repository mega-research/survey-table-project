import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/progress.service', async () => {
  const actual = await vi.importActual<
    typeof import('../services/progress.service')
  >('../services/progress.service');
  return {
    ...actual,
    updateProgressColumns: vi.fn(),
  };
});

import * as svc from '../services/progress.service';
import { progress } from './progress';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';

function scheme() {
  return { version: 1, columns: [{ key: 'month', label: '개최 월', order: 0 }] };
}

describe('operations.progress procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updateColumns는 입력을 service에 위임하고 {ok:true}를 반환한다', async () => {
    vi.mocked(svc.updateProgressColumns).mockResolvedValue({ ok: true } as never);
    const client = createRouterClient({ progress }, { context: authedContext() });
    const input = { surveyId: SURVEY_ID, scheme: scheme() };
    const res = await client.progress.updateColumns(input);
    expect(svc.updateProgressColumns).toHaveBeenCalledWith(input);
    expect(res).toEqual({ ok: true });
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
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(
      client.progress.updateColumns({ surveyId: SURVEY_ID, scheme: scheme() }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
