import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/contact-attr-values.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/contact-attr-values.service')>();
  return {
    ...actual,
    listContactAttrValues: vi.fn(),
  };
});

vi.mock('@/lib/operations/data-scope.server', () => ({
  loadOperationsDataScope: vi.fn(),
}));

import { loadOperationsDataScope } from '@/lib/operations/data-scope.server';
import * as svc from '../services/contact-attr-values.service';
import { attrValues } from './attr-values';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

const SURVEY_ID = '00000000-0000-4000-8000-000000000001';

describe('contacts.attrValues procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list 는 스코프를 해석해 service 에 위임하고 결과를 그대로 반환한다', async () => {
    vi.mocked(loadOperationsDataScope).mockResolvedValue('test');
    vi.mocked(svc.listContactAttrValues).mockResolvedValue({
      values: ['상장', '코스닥'],
      truncated: false,
    });

    const client = createRouterClient({ attrValues }, { context: authedContext() });
    const res = await client.attrValues.list({ surveyId: SURVEY_ID, attrsKey: '기업유형' });

    expect(loadOperationsDataScope).toHaveBeenCalledWith(SURVEY_ID);
    expect(svc.listContactAttrValues).toHaveBeenCalledWith({
      surveyId: SURVEY_ID,
      attrsKey: '기업유형',
      scope: 'test',
    });
    expect(res).toEqual({ values: ['상장', '코스닥'], truncated: false });
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
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(
      client.attrValues.list({ surveyId: SURVEY_ID, attrsKey: '기업유형' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
