import { beforeEach, describe, expect, it, vi } from 'vitest';

// ========================
// 모듈 모킹
// ========================
// updateQuestionResponse 의 변조 가드(#5)를 검증한다.
// - 완료/삭제/타상태 응답의 사후 변조 → UPDATE 0행 → throw
// - 응답의 versionId 스냅샷(또는 surveyId questions)에 없는 questionId → 거부
// - value 직렬화 바이트 상한 초과 → 거부
// - in_progress + 유효 questionId + 정상 크기 → 성공
//
// updateQuestionResponse 는 먼저 응답 행(versionId/surveyId 등)을 조회해 questionId
// 소속을 검증한 뒤, isNull(deletedAt) AND status='in_progress' 가드와 함께 UPDATE 한다.

const {
  responseFindFirstMock,
  questionExistsMock,
  updateReturningMock,
  surveyFindFirstMock,
} = vi.hoisted(() => ({
  responseFindFirstMock: vi.fn(),
  questionExistsMock: vi.fn(),
  updateReturningMock: vi.fn(),
  // 중단 게이트(Task 6): 비-isTest 응답이면 updateQuestionResponse 가
  // getSurveyControlFlags 로 surveys 행을 조회한다 — 이 파일의 관심사(변조 가드 #5)와는
  // 무관하지만, 그 조회 자체가 크래시하지 않도록 기본은 non-paused 로 목킹한다.
  surveyFindFirstMock: vi.fn(),
}));

vi.mock('@/db', () => {
  const chainable: Record<string, unknown> = {};
  chainable['update'] = vi.fn(() => chainable);
  chainable['set'] = vi.fn(() => chainable);
  chainable['where'] = vi.fn(() => {
    // questionId 존재 검사: select().from().where() 직접 await (thenable)
    const whereResult: Record<string, unknown> = {
      limit: vi.fn(() => questionExistsMock()),
      returning: vi.fn(() => updateReturningMock()),
      then: (resolve: (v: unknown) => unknown) => resolve(questionExistsMock()),
    };
    return whereResult;
  });
  chainable['returning'] = vi.fn(() => updateReturningMock());
  chainable['select'] = vi.fn(() => chainable);
  chainable['from'] = vi.fn(() => chainable);
  chainable['limit'] = vi.fn(() => questionExistsMock());
  // assertQuestionBelongsToResponse 의 versionId 분기(PII 플래그 포함 소속 검증)가
  // db.execute(sql...) 를 사용한다. questionExistsMock 을 그대로 재사용 —
  // 기본 { id: QUESTION_ID } 행은 piiEncrypted 필드가 없어 pii=false 로 해석된다.
  chainable['execute'] = vi.fn(async (..._args: unknown[]) => questionExistsMock());
  chainable['query'] = {
    surveyResponses: { findFirst: (...a: unknown[]) => responseFindFirstMock(...a) },
    surveys: { findFirst: (...a: unknown[]) => surveyFindFirstMock(...a) },
  };
  return { db: chainable };
});

vi.mock('@/features/survey-response/server/services/response-answers.service', () => ({
  replaceResponseAnswers: vi.fn(async () => undefined),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const RESPONSE_ID = 'r1';
const SURVEY_ID = 's1';
const VERSION_ID = 'v1';
const QUESTION_ID = 'q-valid';

describe('updateQuestionResponse — 변조 가드(#5)', () => {
  beforeEach(() => {
    responseFindFirstMock.mockReset();
    questionExistsMock.mockReset();
    updateReturningMock.mockReset();
    surveyFindFirstMock.mockReset();
    // 기본: 활성 in_progress 응답 + 유효 questionId + 정상 UPDATE 1행
    responseFindFirstMock.mockResolvedValue({
      id: RESPONSE_ID,
      surveyId: SURVEY_ID,
      versionId: VERSION_ID,
      status: 'in_progress',
      deletedAt: null,
      isTest: false,
    });
    questionExistsMock.mockResolvedValue([{ id: QUESTION_ID }]);
    updateReturningMock.mockResolvedValue([{ id: RESPONSE_ID }]);
    // 중단 게이트(Task 6) 기본값: paused 아님 — 이 파일의 시나리오는 모두 정상 운영 설문 기준.
    surveyFindFirstMock.mockResolvedValue({
      isPaused: false,
      pausedMessage: null,
      testModeEnabled: false,
      testToken: null,
    });
  });

  it('in_progress + 유효 questionId + 정상 크기면 성공한다', async () => {
    const { updateQuestionResponse } = await import('@/features/survey-response/server/services/response.service');
    const res = await updateQuestionResponse({
      responseId: RESPONSE_ID,
      questionId: QUESTION_ID,
      value: 'answer',
    });
    expect(res).toMatchObject({ id: RESPONSE_ID });
  });

  it('완료/삭제/타상태로 UPDATE 가 0행이면 throw 한다 (사후 변조 차단)', async () => {
    // questionId 자체는 유효하나, 가드 WHERE(isNull(deletedAt) AND status=in_progress)에
    // 막혀 UPDATE 가 0행을 반환.
    updateReturningMock.mockResolvedValue([]);
    const { updateQuestionResponse } = await import('@/features/survey-response/server/services/response.service');
    await expect(
      updateQuestionResponse({ responseId: RESPONSE_ID, questionId: QUESTION_ID, value: 'x' }),
    ).rejects.toThrow();
  });

  it('응답 행 자체가 없으면 거부한다', async () => {
    responseFindFirstMock.mockResolvedValue(undefined);
    const { updateQuestionResponse } = await import('@/features/survey-response/server/services/response.service');
    await expect(
      updateQuestionResponse({ responseId: 'missing', questionId: QUESTION_ID, value: 'x' }),
    ).rejects.toThrow();
  });

  it('versionId 스냅샷/surveyId questions 에 없는 questionId 는 거부한다 (임의 키 주입 차단)', async () => {
    // questionId 존재 검사가 빈 결과 → 미존재.
    questionExistsMock.mockResolvedValue([]);
    const { updateQuestionResponse } = await import('@/features/survey-response/server/services/response.service');
    await expect(
      updateQuestionResponse({ responseId: RESPONSE_ID, questionId: 'q-rogue', value: 'x' }),
    ).rejects.toThrow();
  });

  it('value 직렬화 바이트 상한을 초과하면 거부한다', async () => {
    const { updateQuestionResponse } = await import('@/features/survey-response/server/services/response.service');
    // 1MB 가까운 거대 문자열 — 합리적 KB 상한 초과.
    const huge = 'a'.repeat(2_000_000);
    await expect(
      updateQuestionResponse({ responseId: RESPONSE_ID, questionId: QUESTION_ID, value: huge }),
    ).rejects.toThrow();
    // 상한 초과는 DB UPDATE 이전에 차단되어야 한다.
    expect(updateReturningMock).not.toHaveBeenCalled();
  });
});
