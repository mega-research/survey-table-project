import { createRouterClient } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

import * as svc from '../services/response-edit.service';
import { SurveyNotAcceptingResponsesError } from '../services/response.service';
import { edit } from './edit';

vi.mock('../services/response-edit.service', async () => {
  const actual = await vi.importActual<typeof import('../services/response-edit.service')>(
    '../services/response-edit.service',
  );
  return {
    ...actual,
    saveAdminEdit: vi.fn(),
  };
});

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

// 픽스처 UUID 는 v4 형태(...-4xxx-8xxx-...). input 이 z.string() 이라 엄격 강제는 아님.
const SURVEY_ID = '11111111-1111-4111-8111-111111111111';
const RESPONSE_ID = '22222222-2222-4222-8222-222222222222';

describe('surveyResponse.edit procedures', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it('saveAdminEdit는 입력을 service에 위임하고 {ok:true}를 반환한다', async () => {
    vi.mocked(svc.saveAdminEdit).mockResolvedValue({ ok: true } as never);
    const client = createRouterClient({ edit }, { context: authedContext() });
    const input = {
      surveyId: SURVEY_ID,
      responseId: RESPONSE_ID,
      questionResponses: { q1: 'a' },
      versionId: null,
    };
    const res = await client.edit.saveAdminEdit(input);
    expect(svc.saveAdminEdit).toHaveBeenCalledWith(
      input,
      { id: 'admin-1', email: 'a@b.com' },
      false,
    );
    expect(res).toEqual({ ok: true });
  });

  it('SurveyOwnershipError는 NOT_FOUND로 매핑된다', async () => {
    vi.mocked(svc.saveAdminEdit).mockRejectedValue(
      new svc.SurveyOwnershipError('not_found') as never,
    );
    const client = createRouterClient({ edit }, { context: authedContext() });
    await expect(
      client.edit.saveAdminEdit({
        surveyId: SURVEY_ID,
        responseId: RESPONSE_ID,
        questionResponses: {},
        versionId: null,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('response_not_found throw는 NOT_FOUND로 매핑된다', async () => {
    vi.mocked(svc.saveAdminEdit).mockRejectedValue(
      new svc.ResponseEditError('response_not_found') as never,
    );
    const client = createRouterClient({ edit }, { context: authedContext() });
    await expect(
      client.edit.saveAdminEdit({
        surveyId: SURVEY_ID,
        responseId: RESPONSE_ID,
        questionResponses: {},
        versionId: null,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('response_deleted throw는 BAD_REQUEST로 매핑된다', async () => {
    vi.mocked(svc.saveAdminEdit).mockRejectedValue(
      new svc.ResponseEditError('response_deleted') as never,
    );
    const client = createRouterClient({ edit }, { context: authedContext() });
    await expect(
      client.edit.saveAdminEdit({
        surveyId: SURVEY_ID,
        responseId: RESPONSE_ID,
        questionResponses: {},
        versionId: null,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  // A-2f-5: 응답자 경로와 공유하는 크기 가드가 관리자 화면에서 500 이 아니라 BAD_REQUEST 로 보인다.
  it('크기 가드 throw 는 BAD_REQUEST 로 매핑된다', async () => {
    vi.mocked(svc.saveAdminEdit).mockRejectedValue(
      new SurveyNotAcceptingResponsesError('answer_value_too_large') as never,
    );
    const client = createRouterClient({ edit }, { context: authedContext() });
    await expect(
      client.edit.saveAdminEdit({
        surveyId: SURVEY_ID,
        responseId: RESPONSE_ID,
        questionResponses: {},
        versionId: null,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('인증 없으면 saveAdminEdit가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { edit },
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(
      client.edit.saveAdminEdit({
        surveyId: SURVEY_ID,
        responseId: RESPONSE_ID,
        questionResponses: {},
        versionId: null,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('게스트는 grant 설문이면 saveAdminEdit 가 위임된다', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', `guest-1:${SURVEY_ID}`);
    vi.mocked(svc.saveAdminEdit).mockResolvedValue({ ok: true } as never);
    const client = createRouterClient(
      { edit },
      {
        context: {
          db: {} as never,
          supabase: {} as never,
          user: { id: 'guest-1', email: 'g@b.com' },
        },
      },
    );
    const input = {
      surveyId: SURVEY_ID,
      responseId: RESPONSE_ID,
      questionResponses: { q1: 'a' },
      versionId: null,
    };
    const res = await client.edit.saveAdminEdit(input);
    expect(svc.saveAdminEdit).toHaveBeenCalledWith(
      input,
      { id: 'guest-1', email: 'g@b.com' },
      true,
    );
    expect(res).toEqual({ ok: true });
  });

  it('게스트도 이관 versionId 를 실어 saveAdminEdit 가 동일하게 위임된다', async () => {
    // 관리자 수정의 최신 버전 이관·빈 필수 완화는 역할이 아니라 admin-edit 표면에
    // 걸려 있다 — 게스트 grant 사용자도 같은 경로를 그대로 쓴다는 계약을 잠근다.
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', `guest-1:${SURVEY_ID}`);
    vi.mocked(svc.saveAdminEdit).mockResolvedValue({ ok: true } as never);
    const client = createRouterClient(
      { edit },
      {
        context: {
          db: {} as never,
          supabase: {} as never,
          user: { id: 'guest-1', email: 'g@b.com' },
        },
      },
    );
    const input = {
      surveyId: SURVEY_ID,
      responseId: RESPONSE_ID,
      questionResponses: { q1: 'a' },
      versionId: 'version-latest',
    };
    const res = await client.edit.saveAdminEdit(input);
    expect(svc.saveAdminEdit).toHaveBeenCalledWith(
      input,
      { id: 'guest-1', email: 'g@b.com' },
      true,
    );
    expect(res).toEqual({ ok: true });
  });

  it('게스트가 다른 설문 surveyId 로 saveAdminEdit 하면 FORBIDDEN', async () => {
    vi.stubEnv('ADMIN_USER_IDS', 'admin-1');
    vi.stubEnv('GUEST_SURVEY_GRANTS', `guest-1:${SURVEY_ID}`);
    const client = createRouterClient(
      { edit },
      {
        context: {
          db: {} as never,
          supabase: {} as never,
          user: { id: 'guest-1', email: 'g@b.com' },
        },
      },
    );
    await expect(
      client.edit.saveAdminEdit({
        surveyId: 'other-survey',
        responseId: RESPONSE_ID,
        questionResponses: {},
        versionId: null,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(svc.saveAdminEdit).not.toHaveBeenCalled();
  });

  it('versionId 를 service 입력으로 그대로 전달한다', async () => {
    vi.mocked(svc.saveAdminEdit).mockResolvedValue({ ok: true } as never);
    const client = createRouterClient({ edit }, { context: authedContext() });
    const input = {
      surveyId: SURVEY_ID,
      responseId: RESPONSE_ID,
      questionResponses: {},
      versionId: 'v-latest',
    };
    await client.edit.saveAdminEdit(input);
    expect(vi.mocked(svc.saveAdminEdit)).toHaveBeenCalledWith(
      expect.objectContaining({ versionId: 'v-latest' }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('version_conflict 에러를 CONFLICT ORPCError 로 매핑한다', async () => {
    vi.mocked(svc.saveAdminEdit).mockRejectedValue(
      new svc.ResponseEditError('version_conflict') as never,
    );
    const client = createRouterClient({ edit }, { context: authedContext() });
    await expect(
      client.edit.saveAdminEdit({
        surveyId: SURVEY_ID,
        responseId: RESPONSE_ID,
        questionResponses: {},
        versionId: 'v-old',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
