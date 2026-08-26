import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

// capability 관문(티켓 09) — 실물은 DB 를 읽으므로 모킹. 기본은 통과.
vi.mock('@/server/rpc-survey-access', () => ({ assertSurveyCapabilityRpc: vi.fn() }));

vi.mock('../services/survey-lookups', () => ({
  copySavedLookupToSurvey: vi.fn(),
  upsertSurveyLookup: vi.fn(),
  deleteSurveyLookup: vi.fn(),
}));

import * as svc from '../services/survey-lookups';

import { ORPCError } from '@orpc/server';

import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';
import { lookups } from './lookups';

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';
const SAVED_LOOKUP_ID = '22222222-2222-4222-8222-222222222222';
const SURVEY_LOOKUP_ID = '33333333-3333-4333-8333-333333333333';

function authedContext(): ORPCContext {
  return { db: {} as never, user: { id: 'admin-1', email: 'a@b.com', name: '관리자', status: 'active', isSuperadmin: false , userType: 'internal'} };
}

describe('surveyBuilder lookups procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('copy는 surveyId/savedLookupId를 service에 위임하고 결과를 반환한다', async () => {
    vi.mocked(svc.copySavedLookupToSurvey).mockResolvedValue({
      id: 'lut-1',
      name: 'LUT',
    } as never);
    const client = createRouterClient({ lookups }, { context: authedContext() });
    const res = await client.lookups.copy({
      surveyId: SURVEY_ID,
      savedLookupId: SAVED_LOOKUP_ID,
    });
    expect(svc.copySavedLookupToSurvey).toHaveBeenCalledWith(SURVEY_ID, SAVED_LOOKUP_ID);
    expect(res.id).toBe('lut-1');
  });

  it('upsert는 surveyId/lookup을 service에 위임하고 결과를 반환한다', async () => {
    const lookup = { id: 'lut-1', name: 'LUT', columns: ['k'], rows: [{ k: 'v' }] };
    vi.mocked(svc.upsertSurveyLookup).mockResolvedValue(lookup as never);
    const client = createRouterClient({ lookups }, { context: authedContext() });
    const res = await client.lookups.upsert({ surveyId: SURVEY_ID, lookup: lookup as never });
    expect(svc.upsertSurveyLookup).toHaveBeenCalledWith(SURVEY_ID, lookup);
    expect(res.id).toBe('lut-1');
  });

  it('remove는 service 호출 후 ok:true를 반환한다', async () => {
    vi.mocked(svc.deleteSurveyLookup).mockResolvedValue(undefined as never);
    const client = createRouterClient({ lookups }, { context: authedContext() });
    const res = await client.lookups.remove({
      surveyId: SURVEY_ID,
      surveyLookupId: SURVEY_LOOKUP_ID,
    });
    expect(svc.deleteSurveyLookup).toHaveBeenCalledWith(SURVEY_ID, SURVEY_LOOKUP_ID);
    expect(res).toEqual({ ok: true });
  });

  it('인증 없으면 copy가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { lookups },
      { context: { db: {} as never, user: null } },
    );
    await expect(
      client.lookups.copy({ surveyId: SURVEY_ID, savedLookupId: SAVED_LOOKUP_ID }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('surveyBuilder.lookups — capability 관문 (티켓 09)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('LUT mutation 은 survey.edit 관문을 지난다', async () => {
    vi.mocked(svc.upsertSurveyLookup).mockResolvedValue({ id: SURVEY_LOOKUP_ID } as never);
    const context = authedContext();
    const client = createRouterClient({ lookups }, { context });
    await client.lookups.upsert({
      surveyId: SURVEY_ID,
      lookup: { id: SURVEY_LOOKUP_ID, name: 'LUT', columns: [], rows: [] },
    } as never);
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledWith(context.user, SURVEY_ID, 'survey.edit');
  });

  it('타 팀 설문 id 로 LUT 를 지우면 service 에 닿지 않는다', async () => {
    vi.mocked(assertSurveyCapabilityRpc).mockRejectedValue(
      new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' }),
    );
    const client = createRouterClient({ lookups }, { context: authedContext() });
    await expect(
      client.lookups.remove({ surveyId: SURVEY_ID, surveyLookupId: SURVEY_LOOKUP_ID }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(svc.deleteSurveyLookup).not.toHaveBeenCalled();
  });
});
