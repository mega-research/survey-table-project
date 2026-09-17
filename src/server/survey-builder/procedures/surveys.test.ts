import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/surveys', () => ({
  ensureSurveyInDb: vi.fn(),
  createSurvey: vi.fn(),
  updateSurvey: vi.fn(),
  deleteSurvey: vi.fn(),
  restoreSurvey: vi.fn(),
  duplicateSurvey: vi.fn(),
}));

// capability 관문(티켓 09) — 실물은 DB 를 읽으므로 모킹. 기본은 통과.
// toRpcSurveyAccessError 는 순수 매핑이라 실물을 그대로 쓴다(importOriginal spread).
vi.mock('@/server/rpc-survey-access', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  assertSurveyCapabilityRpc: vi.fn(),
}));

import { ORPCError } from '@orpc/server';

import { assertSurveyCapabilityRpc } from '@/server/rpc-survey-access';
import { SurveyAccessError } from '@/server/survey-access';

import * as svc from '../services/surveys';
import { surveys } from './surveys';

function authedContext(): ORPCContext {
  return { db: {} as never, user: { id: 'admin-1', email: 'a@b.com', name: '관리자', status: 'active', isSuperadmin: false , userType: 'internal'} };
}

function anonContext(): ORPCContext {
  return { db: {} as never, user: null };
}

const SURVEY_ID = '11111111-2222-4333-8444-555555555555';

const SETTINGS = {
  isPublic: true,
  allowMultipleResponses: false,
  showProgressBar: true,
  shuffleQuestions: false,
  requireLogin: false,
  thankYouMessage: '응답해주셔서 감사합니다!',
};

const SURVEY_ROW = {
  id: SURVEY_ID,
  title: '설문 제목',
  description: null,
  slug: null,
  privateToken: null,
  isPublic: true,
  createdAt: new Date('2026-06-01T00:00:00Z'),
  updatedAt: new Date('2026-06-01T00:00:00Z'),
};

describe('surveyBuilder.surveys procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ensure는 service.ensureSurveyInDb에 위임하고 결과를 통과시킨다', async () => {
    vi.mocked(svc.ensureSurveyInDb).mockResolvedValue({
      surveyId: SURVEY_ID,
      created: true,
    } as never);
    const context = authedContext();
    const client = createRouterClient({ surveys }, { context });
    const input = { id: SURVEY_ID, title: '설문 제목', settings: SETTINGS };
    const res = await client.surveys.ensure(input);
    expect(svc.ensureSurveyInDb).toHaveBeenCalledWith(context.user, input);
    expect(res).toEqual({ surveyId: SURVEY_ID, created: true });
  });

  it('create는 service.createSurvey에 위임하고 survey 행을 반환한다', async () => {
    vi.mocked(svc.createSurvey).mockResolvedValue(SURVEY_ROW as never);
    const context = authedContext();
    const client = createRouterClient({ surveys }, { context });
    const input = { title: '설문 제목' };
    const res = await client.surveys.create(input);
    expect(svc.createSurvey).toHaveBeenCalledWith(context.user, input);
    expect(res).toMatchObject({ id: SURVEY_ID, title: '설문 제목' });
  });

  it('update는 (surveyId, data)를 단일 input object로 묶어 service에 위임한다', async () => {
    vi.mocked(svc.updateSurvey).mockResolvedValue(SURVEY_ROW as never);
    const context = authedContext();
    const client = createRouterClient({ surveys }, { context });
    const input = { surveyId: SURVEY_ID, data: { title: '바뀐 제목' } };
    const res = await client.surveys.update(input);
    expect(svc.updateSurvey).toHaveBeenCalledWith(input);
    expect(res).toMatchObject({ id: SURVEY_ID });
  });

  it('delete는 service.deleteSurvey에 위임한다(void)', async () => {
    vi.mocked(svc.deleteSurvey).mockResolvedValue(undefined as never);
    const context = authedContext();
    const client = createRouterClient({ surveys }, { context });
    const input = { surveyId: SURVEY_ID };
    await client.surveys.delete(input);
    expect(svc.deleteSurvey).toHaveBeenCalledWith(input);
  });

  it('duplicate는 service.duplicateSurvey에 위임하고 행(또는 null)을 반환한다', async () => {
    vi.mocked(svc.duplicateSurvey).mockResolvedValue(SURVEY_ROW as never);
    const context = authedContext();
    const client = createRouterClient({ surveys }, { context });
    const input = { surveyId: SURVEY_ID };
    const res = await client.surveys.duplicate(input);
    expect(svc.duplicateSurvey).toHaveBeenCalledWith(context.user, input);
    expect(res).toMatchObject({ id: SURVEY_ID });
  });

  it('duplicate는 원본 not found 시 null을 통과시킨다', async () => {
    vi.mocked(svc.duplicateSurvey).mockResolvedValue(null as never);
    const context = authedContext();
    const client = createRouterClient({ surveys }, { context });
    const res = await client.surveys.duplicate({ surveyId: SURVEY_ID });
    expect(res).toBeNull();
  });

  it('인증 없으면 create가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient({ surveys }, { context: anonContext() });
    await expect(client.surveys.create({ title: 'x' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});

describe('surveyBuilder.surveys — update 는 allowlist 다 (Codex 리뷰)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(svc.updateSurvey).mockResolvedValue(SURVEY_ROW as never);
  });

  // survey.edit 만 가진 팀원이 권한·귀속·삭제 컬럼을 payload 로 실어 승격하던 자리다.
  // 조용히 버리면 로그에 안 남으므로 BAD_REQUEST 로 되돌린다.
  const FORBIDDEN_KEYS: Record<string, unknown> = {
    ownerUserId: '99999999-9999-4999-8999-999999999999',
    teamId: '88888888-8888-4888-8888-888888888888',
    assignmentStatus: 'assigned',
    visibility: 'invite_only',
    surveyGroupId: '77777777-7777-4777-8777-777777777777',
    deletedAt: new Date(),
    createdBy: '66666666-6666-4666-8666-666666666666',
    ownershipStatus: 'succession_pending',
    status: 'published',
    currentVersionId: '55555555-5555-4555-8555-555555555555',
    privateToken: 'stolen',
    previewToken: 'stolen',
    testToken: 'stolen',
    isPaused: true,
  };

  it('권한·귀속·삭제 컬럼은 어느 것도 통과하지 못한다 — service 에 닿지 않는다', async () => {
    const client = createRouterClient({ surveys }, { context: authedContext() });

    for (const [key, value] of Object.entries(FORBIDDEN_KEYS)) {
      await expect(
        client.surveys.update({
          surveyId: SURVEY_ID,
          data: { title: '정상 제목', [key]: value } as never,
        }),
      ).rejects.toBeDefined();
    }

    expect(svc.updateSurvey).not.toHaveBeenCalled();
  });

  it('허용 필드만 담긴 요청은 그대로 통과한다', async () => {
    const client = createRouterClient({ surveys }, { context: authedContext() });

    await client.surveys.update({
      surveyId: SURVEY_ID,
      data: { title: '바뀐 제목', isPublic: true, maxResponses: null },
    });

    expect(svc.updateSurvey).toHaveBeenCalledWith({
      surveyId: SURVEY_ID,
      data: { title: '바뀐 제목', isPublic: true, maxResponses: null },
    });
  });
});

describe('surveyBuilder.surveys — capability 관문 (티켓 09)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('update 는 survey.edit, delete 는 survey.delete 관문을 지난다', async () => {
    vi.mocked(svc.updateSurvey).mockResolvedValue(SURVEY_ROW as never);
    vi.mocked(svc.deleteSurvey).mockResolvedValue(undefined as never);
    const context = authedContext();
    const client = createRouterClient({ surveys }, { context });

    await client.surveys.update({ surveyId: SURVEY_ID, data: { title: '바뀐 제목' } });
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledWith(context.user, SURVEY_ID, 'survey.edit');

    await client.surveys.delete({ surveyId: SURVEY_ID });
    expect(assertSurveyCapabilityRpc).toHaveBeenCalledWith(
      context.user,
      SURVEY_ID,
      'survey.delete',
    );
  });

  it('타 팀 설문 id 로 delete 하면 NOT_FOUND — service 에 닿지 않는다', async () => {
    vi.mocked(assertSurveyCapabilityRpc).mockRejectedValue(
      new ORPCError('NOT_FOUND', { message: '설문을 찾을 수 없습니다.' }),
    );
    const client = createRouterClient({ surveys }, { context: authedContext() });
    await expect(client.surveys.delete({ surveyId: SURVEY_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(svc.deleteSurvey).not.toHaveBeenCalled();
  });

  it('편집 권한 없는 update 는 FORBIDDEN — service 에 닿지 않는다', async () => {
    vi.mocked(assertSurveyCapabilityRpc).mockRejectedValue(
      new ORPCError('FORBIDDEN', { message: '이 작업을 수행할 권한이 없습니다.' }),
    );
    const client = createRouterClient({ surveys }, { context: authedContext() });
    await expect(
      client.surveys.update({ surveyId: SURVEY_ID, data: { title: 'x' } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(svc.updateSurvey).not.toHaveBeenCalled();
  });

  it('duplicate 의 서비스 관문 거부(볼 수 없는 원본)는 NOT_FOUND 로 옮긴다', async () => {
    vi.mocked(svc.duplicateSurvey).mockRejectedValue(new SurveyAccessError('not_found'));
    const client = createRouterClient({ surveys }, { context: authedContext() });
    await expect(client.surveys.duplicate({ surveyId: SURVEY_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

/**
 * 삭제 취소 (티켓 17).
 *
 * 여기서 고정하는 것은 **판정 축이 팀이 아니라 전역 권한**이라는 사실이다. capability 관문을
 * 쓸 수 없는 유일한 설문 표면이라(코어가 삭제된 설문을 조회 단계에서 걸러 언제나 not_found
 * 를 준다) 베이스가 유일한 방어선이고, authed 로 내려가는 순간 아무도 눈치채지 못한다.
 */
describe('surveyBuilder.surveys.restore — 슈퍼어드민 전용 (티켓 17)', () => {
  beforeEach(() => vi.clearAllMocks());

  function superadminContext(): ORPCContext {
    return {
      db: {} as never,
      user: {
        id: 'su-1',
        email: 'su@megaresearch.co.kr',
        name: '슈퍼어드민',
        status: 'active',
        isSuperadmin: true,
        userType: 'internal',
      },
    };
  }

  it('슈퍼어드민은 service.restoreSurvey 에 위임한다', async () => {
    vi.mocked(svc.restoreSurvey).mockResolvedValue(undefined as never);
    const client = createRouterClient({ surveys }, { context: superadminContext() });

    await client.surveys.restore({ surveyId: SURVEY_ID });

    expect(svc.restoreSurvey).toHaveBeenCalledWith({ surveyId: SURVEY_ID });
    // capability 관문은 쓰지 않는다 — 쓰면 삭제된 설문이라 언제나 NOT_FOUND 가 된다.
    expect(assertSurveyCapabilityRpc).not.toHaveBeenCalled();
  });

  it('일반 사용자는 FORBIDDEN — service 에 닿지 않는다', async () => {
    const client = createRouterClient({ surveys }, { context: authedContext() });

    await expect(client.surveys.restore({ surveyId: SURVEY_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(svc.restoreSurvey).not.toHaveBeenCalled();
  });

  it('비로그인은 UNAUTHORIZED', async () => {
    const client = createRouterClient({ surveys }, { context: anonContext() });

    await expect(client.surveys.restore({ surveyId: SURVEY_ID })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(svc.restoreSurvey).not.toHaveBeenCalled();
  });

  it('이미 살아 있는 설문(service 의 not_found)은 NOT_FOUND 로 나간다', async () => {
    vi.mocked(svc.restoreSurvey).mockRejectedValue(new SurveyAccessError('not_found'));
    const client = createRouterClient({ surveys }, { context: superadminContext() });

    await expect(client.surveys.restore({ surveyId: SURVEY_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('delete 도 service 의 not_found 를 NOT_FOUND 로 옮긴다 — 경합으로 먼저 지워진 경우', async () => {
    // clearAllMocks 는 구현을 지우지 않는다 — 앞 describe 가 심은 거부가 남아 있으면
    // 관문에서 먼저 떨어져 이 케이스가 검증하려는 자리에 닿지 못한다.
    vi.mocked(assertSurveyCapabilityRpc).mockResolvedValue(undefined);
    vi.mocked(svc.deleteSurvey).mockRejectedValue(new SurveyAccessError('not_found'));
    const client = createRouterClient({ surveys }, { context: authedContext() });

    await expect(client.surveys.delete({ surveyId: SURVEY_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
