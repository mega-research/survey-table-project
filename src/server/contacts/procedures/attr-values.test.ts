import { createRouterClient, ORPCError } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/contact-attr-values', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/contact-attr-values')>();
  return {
    ...actual,
    listContactAttrValues: vi.fn(),
  };
});

vi.mock('@/server/data-scope', () => ({
  loadOperationsDataScope: vi.fn(),
}));

vi.mock('@/server/rpc-survey-access', () => ({ assertScopedSurveyCapabilityRpc: vi.fn() }));

import { loadOperationsDataScope } from '@/server/data-scope';
import { assertScopedSurveyCapabilityRpc } from '@/server/rpc-survey-access';

import * as svc from '../services/contact-attr-values';
import { attrValues } from './attr-values';

function authedContext(): ORPCContext {
  return { db: {} as never, user: { id: 'admin-1', email: 'a@b.com', name: '관리자', status: 'active', isSuperadmin: false , userType: 'internal'} };
}

const SURVEY_ID = '00000000-0000-4000-8000-000000000001';

describe('contacts.attrValues procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list 는 스코프를 해석해 service 에 위임하고 결과를 그대로 반환한다', async () => {
    vi.mocked(loadOperationsDataScope).mockResolvedValue('test');
    vi.mocked(svc.listContactAttrValues).mockResolvedValue({
      values: ['상장', '코스닥'],
      truncated: false,
      hasEmpty: false,
    });

    const context = authedContext();
    const client = createRouterClient({ attrValues }, { context });
    const res = await client.attrValues.list({ surveyId: SURVEY_ID, attrsKey: '기업유형' });

    expect(assertScopedSurveyCapabilityRpc).toHaveBeenCalledWith(
      context.user,
      SURVEY_ID,
      'contacts.view',
    );
    expect(loadOperationsDataScope).toHaveBeenCalledWith(SURVEY_ID);
    expect(svc.listContactAttrValues).toHaveBeenCalledWith({
      surveyId: SURVEY_ID,
      attrsKey: '기업유형',
      scope: 'test',
    });
    expect(res).toEqual({ values: ['상장', '코스닥'], truncated: false, hasEmpty: false });
  });

  it('스킴 밖 컬럼이면 FORBIDDEN_COLUMN 에러로 매핑한다', async () => {
    vi.mocked(loadOperationsDataScope).mockResolvedValue('real');
    vi.mocked(svc.listContactAttrValues).mockRejectedValue(
      new svc.ForbiddenAttrColumnError('없는컬럼'),
    );

    const client = createRouterClient({ attrValues }, { context: authedContext() });
    await expect(
      client.attrValues.list({ surveyId: SURVEY_ID, attrsKey: '없는컬럼' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_COLUMN' });
  });

  it('인증 없으면 UNAUTHORIZED', async () => {
    const client = createRouterClient(
      { attrValues },
      { context: { db: {} as never, user: null } },
    );
    await expect(
      client.attrValues.list({ surveyId: SURVEY_ID, attrsKey: '기업유형' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('타 팀 설문 id 면 NOT_FOUND — 스코프 해석과 서비스에 닿지 않는다', async () => {
    vi.mocked(assertScopedSurveyCapabilityRpc).mockRejectedValueOnce(
      new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' }),
    );
    const client = createRouterClient({ attrValues }, { context: authedContext() });
    await expect(
      client.attrValues.list({ surveyId: SURVEY_ID, attrsKey: '기업유형' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(loadOperationsDataScope).not.toHaveBeenCalled();
    expect(svc.listContactAttrValues).not.toHaveBeenCalled();
  });
});
