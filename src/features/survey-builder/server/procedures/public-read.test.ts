import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/survey-read.service', () => ({
  getSurveyBySlug: vi.fn(),
  getSurveyByPrivateToken: vi.fn(),
  getSurveyForResponse: vi.fn(),
}));

import * as surveySvc from '../services/survey-read.service';
import { publicRead } from './public-read';

const SURVEY_ID = '11111111-2222-4333-8444-555555555555';
const VERSION_ID = '33333333-4444-4555-8666-777777777777';

// 응답자 공개 경로 — 익명 컨텍스트(user: null)에서도 통과해야 한다.
function anonContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: null };
}

describe('surveyBuilder.publicRead procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('bySlug(pub)는 익명 컨텍스트에서 slug 객체를 그대로 위임한다', async () => {
    vi.mocked(surveySvc.getSurveyBySlug).mockResolvedValue({ id: SURVEY_ID } as never);
    const client = createRouterClient({ publicRead }, { context: anonContext() });
    const res = await client.publicRead.bySlug({ slug: 'my-slug' });
    expect(surveySvc.getSurveyBySlug).toHaveBeenCalledWith({ slug: 'my-slug' });
    expect((res as { id: string }).id).toBe(SURVEY_ID);
  });

  it('byPrivateToken(pub)는 token 객체를 그대로 위임한다', async () => {
    vi.mocked(surveySvc.getSurveyByPrivateToken).mockResolvedValue(undefined as never);
    const client = createRouterClient({ publicRead }, { context: anonContext() });
    const res = await client.publicRead.byPrivateToken({ token: 'tok-1' });
    expect(surveySvc.getSurveyByPrivateToken).toHaveBeenCalledWith({ token: 'tok-1' });
    // findFirst 미스 시 undefined → 직렬화 후에도 falsy 동작 보존
    expect(res ?? null).toBeNull();
  });

  it('forResponse(pub)는 surveyId 객체를 그대로 위임하고 결과를 반환한다', async () => {
    vi.mocked(surveySvc.getSurveyForResponse).mockResolvedValue({
      survey: { id: SURVEY_ID },
      versionId: VERSION_ID,
    } as never);
    const client = createRouterClient({ publicRead }, { context: anonContext() });
    const res = await client.publicRead.forResponse({ surveyId: SURVEY_ID });
    expect(surveySvc.getSurveyForResponse).toHaveBeenCalledWith({ surveyId: SURVEY_ID });
    expect((res as { versionId: string }).versionId).toBe(VERSION_ID);
  });

  it('forResponse(pub)는 null 도 통과시킨다', async () => {
    vi.mocked(surveySvc.getSurveyForResponse).mockResolvedValue(null as never);
    const client = createRouterClient({ publicRead }, { context: anonContext() });
    const res = await client.publicRead.forResponse({ surveyId: SURVEY_ID });
    expect(res).toBeNull();
  });

  it('forResponse(pub)는 testToken 을 그대로 위임하고 control 을 반환한다', async () => {
    vi.mocked(surveySvc.getSurveyForResponse).mockResolvedValue({
      survey: { id: SURVEY_ID },
      versionId: VERSION_ID,
      control: { isPaused: false, pausedMessage: null, testSession: 'valid' },
    } as never);
    const client = createRouterClient({ publicRead }, { context: anonContext() });
    const res = await client.publicRead.forResponse({
      surveyId: SURVEY_ID,
      testToken: 'tok-1',
    });
    expect(surveySvc.getSurveyForResponse).toHaveBeenCalledWith({
      surveyId: SURVEY_ID,
      testToken: 'tok-1',
    });
    expect((res as { control: { testSession: string } }).control.testSession).toBe('valid');
  });
});
