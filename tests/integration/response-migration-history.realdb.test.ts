/**
 * 이관 이력 — 실DB 왕복 (CONTEXT.md 「이관 이력」, 0142).
 *
 * 구버전에서 진행 중이던 실응답이 다시 들어오면 재개 이관이 답을 새 버전 구조로 통째 교체한다.
 * 그 순간 옮기기 전 답·두 버전을 이력 한 줄로 같은 트랜잭션에 남긴다. 같은 응답의 재개가 동시에
 * 두 번 와도(탭 둘) 낙관 가드(WHERE version_id = 출발 버전)가 한 번만 통과시키므로 이력도 한 줄이다.
 *
 * 실행: pnpm test:integration (로컬 supabase 54322 필요). 워크트리 공용 DB 라 실행 전 상태 확인.
 */
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import { responseMigrationHistory, surveyResponses, surveys, surveyVersions } from '@/db/schema';
import { MIGRATION_HISTORY_PII_MARKER } from '@/lib/crypto/response-pii';
import type { SurveyVersionSnapshot } from '@/shared/contracts/survey';
import { resumeOrCreateResponse } from '@/server/survey-response/services/lifecycle';

const isLocalDb =
  (process.env['DATABASE_URL'] ?? '').includes('127.0.0.1') ||
  (process.env['DATABASE_URL'] ?? '').includes('localhost');

const createdSurveyIds: string[] = [];

function snapshot(radioOptions: Array<{ id: string; label: string; value: string }>): SurveyVersionSnapshot {
  return {
    title: '이관 이력',
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
    questions: [
      { id: 'q-radio', type: 'radio', title: '보기', required: false, order: 0, options: radioOptions },
      { id: 'q-name', type: 'text', title: '이름', required: false, order: 1 },
    ],
  } as SurveyVersionSnapshot;
}

async function seed(isTest: boolean) {
  const [survey] = await db
    .insert(surveys)
    .values({ title: '이관 이력', status: 'published', testModeEnabled: isTest })
    .returning({ id: surveys.id });
  if (!survey) throw new Error('설문 시드 실패');
  createdSurveyIds.push(survey.id);

  // v1 에는 보기 「둘」이 있고, v2 에서 지웠다 — 그 보기를 고른 답은 이관 때 지워진다.
  const [v1, v2] = await db
    .insert(surveyVersions)
    .values([
      {
        surveyId: survey.id,
        versionNumber: 1,
        status: 'superseded',
        snapshot: snapshot([
          { id: 'o1', label: '하나', value: '1' },
          { id: 'o2', label: '둘', value: '2' },
        ]),
      },
      {
        surveyId: survey.id,
        versionNumber: 2,
        status: 'published',
        snapshot: snapshot([{ id: 'o1', label: '하나', value: '1' }]),
      },
    ])
    .returning({ id: surveyVersions.id });
  if (!v1 || !v2) throw new Error('버전 시드 실패');
  await db.update(surveys).set({ currentVersionId: v2.id }).where(eq(surveys.id, survey.id));

  const sessionId = `migration-history-${crypto.randomUUID()}`;
  const [response] = await db
    .insert(surveyResponses)
    .values({
      surveyId: survey.id,
      versionId: v1.id,
      sessionId,
      isTest,
      status: 'in_progress',
      // q-name 은 암호화 저장된 개인정보 답이라고 친다(값이 암호문 접두사를 가진다)
      questionResponses: { 'q-radio': '2', 'q-name': 'v1:암호문' },
    })
    .returning({ id: surveyResponses.id });
  if (!response) throw new Error('응답 시드 실패');

  return { surveyId: survey.id, v1: v1.id, v2: v2.id, sessionId, responseId: response.id };
}

describe.skipIf(!isLocalDb)('이관 이력 실DB', () => {
  afterAll(async () => {
    if (createdSurveyIds.length === 0) return;
    await db.delete(surveyResponses).where(inArray(surveyResponses.surveyId, createdSurveyIds));
    await db.update(surveys).set({ currentVersionId: null }).where(inArray(surveys.id, createdSurveyIds));
    await db.delete(surveyVersions).where(inArray(surveyVersions.surveyId, createdSurveyIds));
    await db.delete(surveys).where(inArray(surveys.id, createdSurveyIds));
  });

  it('구버전 실응답이 동시에 두 번 재개돼도 이관 이력은 한 줄이고, 암호문은 표식으로 남는다', async () => {
    const seeded = await seed(false);

    await Promise.all([
      resumeOrCreateResponse({ surveyId: seeded.surveyId, sessionId: seeded.sessionId }),
      resumeOrCreateResponse({ surveyId: seeded.surveyId, sessionId: seeded.sessionId }),
    ]);

    const rows = await db
      .select()
      .from(responseMigrationHistory)
      .where(eq(responseMigrationHistory.responseId, seeded.responseId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      surveyId: seeded.surveyId,
      fromVersionId: seeded.v1,
      toVersionId: seeded.v2,
      actor: 'respondent',
      answersBefore: { 'q-radio': '2', 'q-name': MIGRATION_HISTORY_PII_MARKER },
      // 지운 보기를 고른 답은 옮긴 뒤 답에 없다
      answersAfter: { 'q-name': MIGRATION_HISTORY_PII_MARKER },
    });

    const [row] = await db
      .select({ versionId: surveyResponses.versionId })
      .from(surveyResponses)
      .where(eq(surveyResponses.id, seeded.responseId));
    expect(row?.versionId).toBe(seeded.v2);
  });

  it('응답을 완전히 지우면 이관 이력도 함께 지워진다', async () => {
    const seeded = await seed(false);
    await resumeOrCreateResponse({ surveyId: seeded.surveyId, sessionId: seeded.sessionId });

    await db.delete(surveyResponses).where(eq(surveyResponses.id, seeded.responseId));

    const rows = await db
      .select({ id: responseMigrationHistory.id })
      .from(responseMigrationHistory)
      .where(eq(responseMigrationHistory.responseId, seeded.responseId));
    expect(rows).toHaveLength(0);
  });
});
