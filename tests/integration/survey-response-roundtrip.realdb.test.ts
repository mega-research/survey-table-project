/**
 * surveyResponse.response procedure 실 DB 왕복 integration test
 *
 * 목적: procedure -> service -> 실 PostgreSQL 왕복(응답 생성 + 완료 + response_answers
 * 정규화)이 실제로 돈다는 것을 CI에 고정. completeResponse 의 트랜잭션 + progressPct=100
 * + response_answers 정규화 불변식(A)을 실DB에서 검증한다.
 *
 * 실행 조건: DATABASE_URL이 127.0.0.1 또는 localhost를 포함할 때만 동작.
 * prod URL 환경에서는 describe.skipIf로 전체 스킵 -> 일반 pnpm test에서 데이터 오염 없음.
 *
 * headers() 처리: createResponseWithFirstAnswer 가 next/headers 의 await headers() 로
 * UA를 읽는다. vitest node 환경에는 Next 요청 스코프가 없어 throw 하므로 next/headers 를
 * mock 해 테스트 요청 헤더를 반환시킨다. 익명 응답은 clientSignals 가 없으면 봇 방어로
 * 차단되므로, 정상 브라우저 제출처럼 최소 clientSignals 를 넣어 round-trip 을 검증한다.
 */

import { createRouterClient } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// next/headers mock: createResponseWithFirstAnswer 의 await headers() 가 테스트 요청 헤더를 받게 한다.
vi.mock('next/headers', () => ({
  headers: () =>
    Promise.resolve(
      new Headers({
        'x-real-ip': '203.0.113.7',
        'user-agent': 'Vitest survey-response roundtrip',
      }),
    ),
}));

import { db } from '@/db';
import {
  questions as questionsTable,
  responseAnswers as responseAnswersTable,
  surveyResponses as surveyResponsesTable,
  surveys as surveysTable,
  surveyVersions as surveyVersionsTable,
} from '@/db/schema';
import type { SurveyVersionSnapshot } from '@/db/schema/schema-types';
import type { ORPCContext } from '@/server/context';

import { response } from '@/features/survey-response/server/procedures/response';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');
const CLIENT_SIGNALS = {
  deviceId: 'roundtrip-device-1',
  screen: '1920x1080',
  tz: 'Asia/Seoul',
  lang: 'ko-KR',
  platform: 'MacIntel',
};

function anonContext(): ORPCContext {
  return {
    db,
    supabase: {} as never,
    user: null,
    headers: new Headers({ 'x-real-ip': '203.0.113.7' }),
  };
}

describe.skipIf(!isLocalDb)('surveyResponse.response procedure round-trip (real local DB)', () => {
  const client = createRouterClient({ response }, { context: anonContext() });
  const createdSurveyIds: string[] = [];

  beforeEach(() => vi.clearAllMocks());

  afterAll(async () => {
    for (const id of createdSurveyIds) {
      // survey 삭제 시 questions/survey_versions/survey_responses/response_answers 는
      // FK cascade 로 정리되지만 명시적으로 survey 만 지워도 충분하다.
      await db.delete(surveysTable).where(eq(surveysTable.id, id));
    }
  });

  it('createWithFirstAnswer -> complete 왕복: progressPct=100 + response_answers 정규화가 DB에 반영된다', async () => {
    // 1. survey + question + version 선행 insert
    const [survey] = await db
      .insert(surveysTable)
      .values({ title: '응답-왕복-테스트-설문' })
      .returning({ id: surveysTable.id });
    if (!survey) throw new Error('survey 삽입 실패');
    createdSurveyIds.push(survey.id);

    const [question] = await db
      .insert(questionsTable)
      .values({ surveyId: survey.id, type: 'text', title: '이름을 입력하세요', order: 1 })
      .returning({ id: questionsTable.id });
    if (!question) throw new Error('question 삽입 실패');

    const snapshot: SurveyVersionSnapshot = {
      title: '응답-왕복-테스트-설문',
      questions: [
        {
          id: question.id,
          type: 'text',
          title: '이름을 입력하세요',
        } as unknown as SurveyVersionSnapshot['questions'][number],
      ],
      groups: [],
      settings: {
        isPublic: true,
        allowMultipleResponses: false,
        showProgressBar: true,
        shuffleQuestions: false,
        requireLogin: false,
        thankYouMessage: '감사합니다',
      },
    };

    const [version] = await db
      .insert(surveyVersionsTable)
      .values({ surveyId: survey.id, versionNumber: 1, snapshot })
      .returning({ id: surveyVersionsTable.id });
    if (!version) throw new Error('survey_version 삽입 실패');

    // 2. createWithFirstAnswer: 첫 답변과 함께 응답 행 생성 (익명 정상 브라우저 제출)
    const created = await client.response.createWithFirstAnswer({
      surveyId: survey.id,
      sessionId: 'roundtrip-session-1',
      versionId: version.id,
      questionId: question.id,
      value: '홍길동',
      currentStepId: `group:${survey.id}`,
      clientSignals: CLIENT_SIGNALS,
    });
    expect(created.kind).toBe('created');
    if (created.kind !== 'created') throw new Error('created 분기 기대');
    const responseId = created.id;
    expect(typeof responseId).toBe('string');

    // 3. complete: questionResponses 와 함께 완료
    const completed = await client.response.complete({
      responseId,
      data: {
        questionResponses: { [question.id]: '홍길동' },
        exposedQuestionIds: [question.id],
      },
    });
    expect(completed.id).toBe(responseId);

    // 4. survey_responses 검증: isCompleted/status/progressPct
    const [row] = await db
      .select({
        isCompleted: surveyResponsesTable.isCompleted,
        status: surveyResponsesTable.status,
        progressPct: surveyResponsesTable.progressPct,
        questionResponses: surveyResponsesTable.questionResponses,
      })
      .from(surveyResponsesTable)
      .where(eq(surveyResponsesTable.id, responseId));
    expect(row?.isCompleted).toBe(true);
    expect(row?.status).toBe('completed');
    expect(row?.progressPct).toBe(100);
    expect(row?.questionResponses).toEqual({ [question.id]: '홍길동' });

    // 5. response_answers 정규화 행 검증 (불변식 A — completeResponse 가 채운다)
    const answers = await db
      .select({
        questionId: responseAnswersTable.questionId,
        textValue: responseAnswersTable.textValue,
        questionType: responseAnswersTable.questionType,
      })
      .from(responseAnswersTable)
      .where(eq(responseAnswersTable.responseId, responseId));
    expect(answers.length).toBe(1);
    expect(answers[0]?.questionId).toBe(question.id);
    expect(answers[0]?.textValue).toBe('홍길동');
    expect(answers[0]?.questionType).toBe('text');
  });
});
