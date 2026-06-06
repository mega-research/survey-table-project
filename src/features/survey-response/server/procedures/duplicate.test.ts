import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/duplicate.service', () => ({
  checkDuplicateOnEntry: vi.fn(),
}));

import * as svc from '../services/duplicate.service';
import { duplicate } from './duplicate';

function anonContext(): ORPCContext {
  return {
    db: {} as never,
    supabase: { tag: 'anon-supabase' } as never,
    user: null,
  };
}

const SURVEY_ID = '22222222-3333-4444-8555-666666666666';
const CONTACT_ID = '55555555-6666-4777-8888-999999999999';
const INVITE_TOKEN = '66666666-7777-4888-8999-aaaaaaaaaaaa';

const CLIENT_SIGNALS = {
  deviceId: 'device-abc',
  screen: '1920x1080',
  tz: 'Asia/Seoul',
  lang: 'ko-KR',
  platform: 'MacIntel',
};

describe('surveyResponse.duplicate procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('checkOnEntry(pub)는 통과(blocked:false) 결과를 그대로 반환한다', async () => {
    vi.mocked(svc.checkDuplicateOnEntry).mockResolvedValue({ blocked: false } as never);
    const client = createRouterClient({ duplicate }, { context: anonContext() });
    const res = await client.duplicate.checkOnEntry({
      surveyId: SURVEY_ID,
      clientSignals: CLIENT_SIGNALS,
    });
    expect(res).toEqual({ blocked: false });
    expect(svc.checkDuplicateOnEntry).toHaveBeenCalledWith({
      surveyId: SURVEY_ID,
      clientSignals: CLIENT_SIGNALS,
    });
  });

  it('checkOnEntry(pub)는 Track A 통과 시 contactTargetId 동봉 결과를 통과시킨다', async () => {
    vi.mocked(svc.checkDuplicateOnEntry).mockResolvedValue({
      blocked: false,
      contactTargetId: CONTACT_ID,
    } as never);
    const client = createRouterClient({ duplicate }, { context: anonContext() });
    const res = await client.duplicate.checkOnEntry({
      surveyId: SURVEY_ID,
      inviteToken: INVITE_TOKEN,
      clientSignals: null,
    });
    expect(res).toEqual({ blocked: false, contactTargetId: CONTACT_ID });
    expect(svc.checkDuplicateOnEntry).toHaveBeenCalledWith({
      surveyId: SURVEY_ID,
      inviteToken: INVITE_TOKEN,
      clientSignals: null,
    });
  });

  it('checkOnEntry(pub)는 차단(blocked:true) 결과(reason)를 통과시킨다', async () => {
    vi.mocked(svc.checkDuplicateOnEntry).mockResolvedValue({
      blocked: true,
      reason: 'token_already_used',
    } as never);
    const client = createRouterClient({ duplicate }, { context: anonContext() });
    const res = await client.duplicate.checkOnEntry({
      surveyId: SURVEY_ID,
      inviteToken: INVITE_TOKEN,
      clientSignals: null,
    });
    expect(res).toEqual({ blocked: true, reason: 'token_already_used' });
  });

  it('checkOnEntry(pub)는 clientSignals null 도 input 검증을 통과시켜 service 에 위임한다', async () => {
    vi.mocked(svc.checkDuplicateOnEntry).mockResolvedValue({ blocked: false } as never);
    const client = createRouterClient({ duplicate }, { context: anonContext() });
    await client.duplicate.checkOnEntry({ surveyId: SURVEY_ID, clientSignals: null });
    expect(svc.checkDuplicateOnEntry).toHaveBeenCalledWith({
      surveyId: SURVEY_ID,
      clientSignals: null,
    });
  });
});
