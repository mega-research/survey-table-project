import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

import * as svc from '../services/scale-mean';
import { scaleMean } from './scale-mean';

vi.mock('../services/scale-mean', () => ({
  setScaleMeanQuestions: vi.fn(),
}));

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';

describe('operations.scaleMean procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('setQuestions 는 입력을 service 에 위임하고 결과를 그대로 돌려준다', async () => {
    vi.mocked(svc.setScaleMeanQuestions).mockResolvedValue({ ok: true });
    const client = createRouterClient({ scaleMean }, { context: authedContext() });
    const input = { surveyId: SURVEY_ID, questionIds: ['q1', 'q2'] };
    await expect(client.scaleMean.setQuestions(input)).resolves.toEqual({ ok: true });
    expect(svc.setScaleMeanQuestions).toHaveBeenCalledWith(input);
  });

  it('거부 결과 {ok:false,error} 는 throw 없이 그대로 통과한다', async () => {
    vi.mocked(svc.setScaleMeanQuestions).mockResolvedValue({ ok: false, error: '안 됨' });
    const client = createRouterClient({ scaleMean }, { context: authedContext() });
    await expect(
      client.scaleMean.setQuestions({ surveyId: SURVEY_ID, questionIds: ['x'] }),
    ).resolves.toEqual({ ok: false, error: '안 됨' });
  });

  it('인증 없으면 UNAUTHORIZED 로 막히고 service 를 부르지 않는다', async () => {
    const client = createRouterClient(
      { scaleMean },
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(
      client.scaleMean.setQuestions({ surveyId: SURVEY_ID, questionIds: [] }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(svc.setScaleMeanQuestions).not.toHaveBeenCalled();
  });

  it('게스트는 grant 일치 설문이어도 FORBIDDEN — 척도 평균은 내부 담당자 화면이다', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', `guest-1:${SURVEY_ID}`);
    const client = createRouterClient(
      { scaleMean },
      {
        context: {
          db: {} as never,
          supabase: {} as never,
          user: { id: 'guest-1', email: 'g@b.com' },
        },
      },
    );
    await expect(
      client.scaleMean.setQuestions({ surveyId: SURVEY_ID, questionIds: [] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(svc.setScaleMeanQuestions).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('surveyId 가 UUID 가 아니면 입력 검증에서 막힌다', async () => {
    const client = createRouterClient({ scaleMean }, { context: authedContext() });
    await expect(
      client.scaleMean.setQuestions({ surveyId: 'nope', questionIds: [] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
