import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  completedResponse,
  contactUpdateError,
  transactionCommitted,
  resetTransactionState,
  markTransactionCommitted,
} = vi.hoisted(() => {
  const response = {
    id: 'response-1',
    surveyId: 'survey-1',
    contactTargetId: 'contact-1',
    isTest: false,
    isCompleted: true,
    status: 'completed',
    deletedAt: null,
    pageVisits: null,
  };
  const error = new Error('contact update failed');
  let committed = false;
  return {
    completedResponse: response,
    contactUpdateError: error,
    transactionCommitted: () => committed,
    resetTransactionState: () => {
      committed = false;
    },
    markTransactionCommitted: () => {
      committed = true;
    },
  };
});

vi.mock('@/db', () => {
  const makeResponseUpdate = () => {
    const chain: Record<string, unknown> = {};
    chain['set'] = vi.fn(() => chain);
    chain['where'] = vi.fn(() => chain);
    chain['returning'] = vi.fn(async () => [completedResponse]);
    return chain;
  };
  const makeFailedContactUpdate = () => {
    const chain: Record<string, unknown> = {};
    chain['set'] = vi.fn(() => chain);
    chain['where'] = vi.fn(async () => {
      throw contactUpdateError;
    });
    return chain;
  };
  const makeCountSelect = () => {
    const result = Promise.resolve([{ total: 0 }]);
    const chain: Record<string, unknown> = {};
    chain['from'] = vi.fn(() => chain);
    chain['where'] = vi.fn(() => result);
    return chain;
  };

  return {
    db: {
      query: {
        surveyResponses: {
          findFirst: vi.fn(async () => ({
            surveyId: completedResponse.surveyId,
            versionId: null,
            contactTargetId: completedResponse.contactTargetId,
            isTest: false,
          })),
        },
        surveys: {
          findFirst: vi.fn(async () => ({
            status: 'published',
            endDate: null,
            maxResponses: null,
            isPublic: true,
            requireInviteToken: false,
          })),
        },
      },
      select: vi.fn(() => makeCountSelect()),
      update: vi.fn(() => makeFailedContactUpdate()),
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
        let updateCall = 0;
        const result = await callback({
          update: vi.fn(() => {
            updateCall += 1;
            return updateCall === 1 ? makeResponseUpdate() : makeFailedContactUpdate();
          }),
        });
        markTransactionCommitted();
        return result;
      }),
    },
  };
});

vi.mock('@/server/survey-response/services/response-answers', () => ({
  replaceResponseAnswers: vi.fn(async () => undefined),
}));

describe('completeResponse 실제 대상자 후처리', () => {
  beforeEach(() => {
    resetTransactionState();
    vi.restoreAllMocks();
  });

  it('컨택 연결 갱신 실패가 이미 완료된 응답을 rollback하지 않는다', async () => {
    const { logger } = await import('@/lib/logger');
    const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const { completeResponse } =
      await import('@/server/survey-response/services/response-completion');

    await expect(completeResponse({ responseId: completedResponse.id })).resolves.toMatchObject({
      id: completedResponse.id,
      status: 'completed',
    });
    expect(transactionCommitted()).toBe(true);
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({ responseId: completedResponse.id, err: contactUpdateError }),
      expect.stringContaining('contact_targets UPDATE 실패'),
    );
  });
});
