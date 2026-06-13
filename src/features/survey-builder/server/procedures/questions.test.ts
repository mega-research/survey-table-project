import { createRouterClient } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ORPCContext } from '@/server/context';

vi.mock('../services/questions.service', async () => {
  const actual = await vi.importActual<
    typeof import('../services/questions.service')
  >('../services/questions.service');
  return {
    ...actual,
    createQuestion: vi.fn(),
    updateQuestion: vi.fn(),
    deleteQuestion: vi.fn(),
    reorderQuestions: vi.fn(),
  };
});

import * as svc from '../services/questions.service';
import { questions } from './questions';

function authedContext(): ORPCContext {
  return { db: {} as never, supabase: {} as never, user: { id: 'admin-1', email: 'a@b.com' } };
}

const SURVEY_ID = '11111111-1111-4111-8111-111111111111';
const QUESTION_ID = '22222222-2222-4222-8222-222222222222';
const GROUP_ID = '33333333-3333-4333-8333-333333333333';

describe('surveyBuilder.questions procedures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('create는 service.createQuestion에 위임하고 행을 반환한다', async () => {
    const row = { id: QUESTION_ID, surveyId: SURVEY_ID, type: 'text', title: 'Q1' };
    vi.mocked(svc.createQuestion).mockResolvedValue(row as never);
    const client = createRouterClient({ questions }, { context: authedContext() });
    const input = { surveyId: SURVEY_ID, type: 'text' as const, title: 'Q1' };
    const res = await client.questions.create(input);
    expect(svc.createQuestion).toHaveBeenCalledWith(input);
    expect(res).toEqual(row);
  });

  it('update는 service.updateQuestion에 (questionId, surveyId, data)로 위임한다', async () => {
    const row = { id: QUESTION_ID, surveyId: SURVEY_ID, type: 'text', title: 'Q1-edit' };
    vi.mocked(svc.updateQuestion).mockResolvedValue(row as never);
    const client = createRouterClient({ questions }, { context: authedContext() });
    const res = await client.questions.update({
      questionId: QUESTION_ID,
      surveyId: SURVEY_ID,
      data: { title: 'Q1-edit', groupId: GROUP_ID },
    });
    expect(svc.updateQuestion).toHaveBeenCalledWith(QUESTION_ID, SURVEY_ID, {
      title: 'Q1-edit',
      groupId: GROUP_ID,
    });
    expect(res).toEqual(row);
  });

  it('create는 단답형 inputType/emptyDefault/defaultValueTemplate를 strip 없이 전달한다', async () => {
    // 회귀(H17): 이 3필드가 zod 스키마에서 누락되면 검증 단계에서 silent strip되어
    // 리로드 시 손실된다. 스키마에 포함되어야 service까지 그대로 도달한다.
    const row = { id: QUESTION_ID, surveyId: SURVEY_ID, type: 'text', title: 'Q1' };
    vi.mocked(svc.createQuestion).mockResolvedValue(row as never);
    const client = createRouterClient({ questions }, { context: authedContext() });
    const input = {
      surveyId: SURVEY_ID,
      type: 'text' as const,
      title: 'Q1',
      inputType: 'number' as const,
      emptyDefault: 7,
      defaultValueTemplate: '{{attrs_age}}',
    };
    await client.questions.create(input);
    expect(svc.createQuestion).toHaveBeenCalledWith(input);
  });

  it('update는 단답형 inputType/emptyDefault/defaultValueTemplate를 strip 없이 전달한다', async () => {
    // 회귀(H17): UpdateQuestionData 스키마에 3필드가 없으면 모달 직접 저장 payload가
    // silent strip되어 리로드 시 손실된다.
    const row = { id: QUESTION_ID, surveyId: SURVEY_ID, type: 'text', title: 'Q1' };
    vi.mocked(svc.updateQuestion).mockResolvedValue(row as never);
    const client = createRouterClient({ questions }, { context: authedContext() });
    const data = {
      inputType: 'number' as const,
      emptyDefault: 3,
      defaultValueTemplate: '{{attrs_score}}',
    };
    await client.questions.update({ questionId: QUESTION_ID, surveyId: SURVEY_ID, data });
    expect(svc.updateQuestion).toHaveBeenCalledWith(QUESTION_ID, SURVEY_ID, data);
  });

  it('update payload의 type은 strip되어 service에 도달하지 않는다', async () => {
    // 질문 type은 생성 후 불변 — UpdateQuestionData에 type이 없으므로
    // 구버전 클라이언트가 type을 실어 보내도 zod strip으로 무시된다(reject 아님).
    const row = { id: QUESTION_ID, surveyId: SURVEY_ID, type: 'text', title: 'Q1' };
    vi.mocked(svc.updateQuestion).mockResolvedValue(row as never);
    const client = createRouterClient({ questions }, { context: authedContext() });
    await client.questions.update({
      questionId: QUESTION_ID,
      surveyId: SURVEY_ID,
      data: { title: 'Q1', type: 'table' } as { title: string },
    });
    expect(svc.updateQuestion).toHaveBeenCalledWith(QUESTION_ID, SURVEY_ID, { title: 'Q1' });
  });

  it('create는 9종 외 type을 BAD_REQUEST로 거부한다', async () => {
    const client = createRouterClient({ questions }, { context: authedContext() });
    await expect(
      client.questions.create({
        surveyId: SURVEY_ID,
        type: 'file-upload' as 'text',
        title: 'Q1',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(svc.createQuestion).not.toHaveBeenCalled();
  });

  it('remove는 service.deleteQuestion에 (questionId, surveyId)로 위임하고 {ok:true}를 반환한다', async () => {
    vi.mocked(svc.deleteQuestion).mockResolvedValue({ ok: true } as never);
    const client = createRouterClient({ questions }, { context: authedContext() });
    const res = await client.questions.remove({ questionId: QUESTION_ID, surveyId: SURVEY_ID });
    expect(svc.deleteQuestion).toHaveBeenCalledWith(QUESTION_ID, SURVEY_ID);
    expect(res).toEqual({ ok: true });
  });

  it('reorder는 service.reorderQuestions에 (questionIds, surveyId)로 위임한다', async () => {
    vi.mocked(svc.reorderQuestions).mockResolvedValue({ ok: true } as never);
    const client = createRouterClient({ questions }, { context: authedContext() });
    const ids = [QUESTION_ID, GROUP_ID];
    const res = await client.questions.reorder({ questionIds: ids, surveyId: SURVEY_ID });
    expect(svc.reorderQuestions).toHaveBeenCalledWith(ids, SURVEY_ID);
    expect(res).toEqual({ ok: true });
  });

  it('인증 없으면 create가 UNAUTHORIZED로 막힌다', async () => {
    const client = createRouterClient(
      { questions },
      { context: { db: {} as never, supabase: {} as never, user: null } },
    );
    await expect(
      client.questions.create({ surveyId: SURVEY_ID, type: 'text', title: 'Q1' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('update 서비스가 "질문 업데이트에 실패했습니다." 에러 throw 시 NOT_FOUND로 매핑한다', async () => {
    // 미영속 질문에 대해 update 경로가 실행될 때(0행 매칭) 서비스가 throw하는 에러를
    // oRPC가 Internal server error로 마스킹하지 않고 NOT_FOUND로 노출해야 한다.
    vi.mocked(svc.updateQuestion).mockRejectedValue(new Error('질문 업데이트에 실패했습니다.'));
    const client = createRouterClient({ questions }, { context: authedContext() });
    await expect(
      client.questions.update({ questionId: QUESTION_ID, surveyId: SURVEY_ID, data: { title: 'Q1-edit' } }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: '질문을 찾을 수 없습니다. 설문을 먼저 저장한 뒤 다시 시도하세요.',
    });
  });

  it('update 서비스가 다른 에러 throw 시 그대로 재전파한다', async () => {
    vi.mocked(svc.updateQuestion).mockRejectedValue(new Error('DB 연결 오류'));
    const client = createRouterClient({ questions }, { context: authedContext() });
    await expect(
      client.questions.update({ questionId: QUESTION_ID, surveyId: SURVEY_ID, data: { title: 'Q1-edit' } }),
    ).rejects.toMatchObject({ message: 'DB 연결 오류' });
  });
});
