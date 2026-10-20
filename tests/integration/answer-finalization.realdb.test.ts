/**
 * 응답 확정 — 세 경로가 같은 확정을 거치는지 실DB 왕복으로 확인한다.
 *
 * 확정 단계를 설문 구성(계산 칸·게이팅 칸 유무)이나 변경 유무로 건너뛰던 시절의 빈틈 둘을 못 박는다.
 * - 표시 조건만 있는 설문의 빈 complete 가 저장된 숨은 문항 값을 지우지 않았다
 * - 관리자 수정이 아무것도 안 고친 이탈 응답을 strip·자격미달 판정 없이 completed 로 확정했다
 *
 * 실행: pnpm test:integration (로컬 supabase 54322 필요)
 */
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { surveys, surveyVersions, surveyResponses } from '@/db/schema';
import type { QuestionData, SurveyVersionSnapshot } from '@/shared/contracts/survey';
import type { ResponseStatus } from '@/shared/contracts/survey-response';
import { completeResponse } from '@/server/survey-response/services/response-completion';
import { saveAdminEdit } from '@/server/survey-response/services/response-edit';

const isLocalDb =
  (process.env['DATABASE_URL'] ?? '').includes('127.0.0.1') ||
  (process.env['DATABASE_URL'] ?? '').includes('localhost');

const createdSurveyIds: string[] = [];

/** q-ctrl 이 'yes' 가 아니면 숨는 문항 — 계산 칸·게이팅 칸은 없다. */
const HIDDEN_BY_CTRL: QuestionData = {
  id: 'q-hid',
  type: 'text',
  title: '숨는 문항',
  required: false,
  order: 1,
  displayCondition: {
    logicType: 'AND',
    conditions: [
      {
        id: 'hid-c1',
        enabled: true,
        logicType: 'AND',
        conditionType: 'value-match',
        sourceQuestionId: 'q-ctrl',
        requiredValues: ['yes'],
      },
    ],
  },
};

function buildSnapshot(questions: QuestionData[]): SurveyVersionSnapshot {
  return {
    title: '응답 확정 테스트',
    description: '',
    groups: [],
    settings: {
      isPublic: true,
      allowMultipleResponses: false,
      showProgressBar: false,
      shuffleQuestions: false,
      requireLogin: false,
      thankYouMessage: '',
    },
    questions,
  };
}

async function seed(
  questions: QuestionData[],
  row: { status: ResponseStatus; questionResponses: Record<string, unknown> },
) {
  const [survey] = await db
    .insert(surveys)
    .values({ title: '응답 확정 왕복 테스트', status: 'published' })
    .returning();
  if (!survey) throw new Error('설문 시드 실패');
  createdSurveyIds.push(survey.id);

  const [version] = await db
    .insert(surveyVersions)
    .values({
      surveyId: survey.id,
      versionNumber: 1,
      status: 'published',
      snapshot: buildSnapshot(questions),
      publishedAt: new Date(),
    })
    .returning();
  if (!version) throw new Error('버전 시드 실패');
  await db.update(surveys).set({ currentVersionId: version.id }).where(eq(surveys.id, survey.id));

  const [response] = await db
    .insert(surveyResponses)
    .values({
      surveyId: survey.id,
      versionId: version.id,
      sessionId: `seed-${crypto.randomUUID()}`,
      status: row.status,
      isCompleted: false,
      questionResponses: row.questionResponses,
    })
    .returning();
  if (!response) throw new Error('응답 시드 실패');

  return { surveyId: survey.id, versionId: version.id, responseId: response.id };
}

async function readRow(responseId: string) {
  const [row] = await db
    .select({
      status: surveyResponses.status,
      isCompleted: surveyResponses.isCompleted,
      questionResponses: surveyResponses.questionResponses,
    })
    .from(surveyResponses)
    .where(eq(surveyResponses.id, responseId));
  return row;
}

describe.skipIf(!isLocalDb)('응답 확정 실DB 왕복', () => {
  afterAll(async () => {
    if (createdSurveyIds.length > 0) {
      await db.delete(surveyResponses).where(inArray(surveyResponses.surveyId, createdSurveyIds));
      await db.update(surveys).set({ currentVersionId: null }).where(inArray(surveys.id, createdSurveyIds));
      await db.delete(surveyVersions).where(inArray(surveyVersions.surveyId, createdSurveyIds));
      await db.delete(surveys).where(inArray(surveys.id, createdSurveyIds));
    }
  });

  it('표시 조건만 있는 설문의 빈 complete 도 초안에 남은 숨은 문항 값을 지운다', async () => {
    const { responseId } = await seed(
      [{ id: 'q-ctrl', type: 'radio', title: '상류', required: false, order: 0 }, HIDDEN_BY_CTRL],
      // 초안 저장은 strip 하지 않는다 — 숨기 전에 적은 값이 그대로 남아 있는 상태
      { status: 'in_progress', questionResponses: { 'q-ctrl': 'no', 'q-hid': '숨기 전에 적은 값' } },
    );

    await completeResponse({ responseId });

    const row = await readRow(responseId);
    expect(row?.status).toBe('completed');
    expect(row?.questionResponses).toEqual({ 'q-ctrl': 'no' });
  });

  it('관리자가 아무것도 안 고친 이탈 응답을 완료로 바꿀 때도 strip 과 자격미달 판정을 거친다', async () => {
    const { surveyId, versionId, responseId } = await seed(
      [
        {
          id: 'q-ctrl',
          type: 'radio',
          title: '학년',
          required: true,
          order: 0,
          options: [
            {
              id: 'opt-low',
              label: '1학년',
              value: 'no',
              branchRule: { id: 'br-1', value: '', action: 'end', endOutcome: 'screened_out' },
            },
            { id: 'opt-yes', label: '졸업자', value: 'yes' },
          ],
        },
        HIDDEN_BY_CTRL,
      ],
      { status: 'drop', questionResponses: { 'q-ctrl': 'no', 'q-hid': '숨기 전에 적은 값' } },
    );

    // 화면이 저장값을 그대로 다시 보낸 상태 — 바뀐 문항이 없다
    await saveAdminEdit(
      {
        surveyId,
        responseId,
        versionId,
        questionResponses: { 'q-ctrl': 'no', 'q-hid': '숨기 전에 적은 값' },
      },
      { attribution: { accountUserId: null, fieldworkLinkId: null }, email: null },
      false,
    );

    const row = await readRow(responseId);
    expect(row?.status).toBe('screened_out');
    expect(row?.isCompleted).toBe(false);
    expect(row?.questionResponses).toEqual({ 'q-ctrl': 'no' });
  });
});
