/**
 * publish 시 응답 없는 이전 버전 스냅샷 자동 정리 — 실 DB 검증
 *
 * 배경: survey_versions.snapshot 이 publish 마다 통째로 쌓여 DB 절반 이상을
 * 차지했다(2026-08-10 프로덕션 일회성 정리 선례). publishSurvey 가 새 버전을
 * 만든 뒤, 같은 설문의 이전 버전 중 응답이 한 건도 참조하지 않는 버전을
 * 트랜잭션 안에서 삭제해 다시 쌓이지 않게 한다.
 *
 * 보존 불변식 (일회성 정리 SQL 과 동일한 3중 가드):
 *   - 응답(진행 중 포함)이 참조하는 버전은 보존 — 응답 수정 calc 재계산·운영
 *     집계·이전 버전 진행 중 응답 검증이 그 스냅샷을 읽는다
 *   - 방금 만든 버전(= currentVersionId = 설문별 최신)은 보존
 *   - versionNumber 는 최신 버전이 항상 남으므로 재사용 없이 단조 증가
 *
 * 실행 조건: 로컬 DB(127.0.0.1/localhost)에서만. pnpm test:integration.
 */

import { asc, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  questions as questionsTable,
  surveyResponses as surveyResponsesTable,
  surveys as surveysTable,
  surveyVersions as surveyVersionsTable,
} from '@/db/schema';

import { publishSurvey } from '@/features/survey-builder/server/services/survey-publish.service';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

async function createPublishableSurvey(): Promise<string> {
  const [survey] = await db
    .insert(surveysTable)
    .values({ title: '버전 정리 테스트 설문' })
    .returning({ id: surveysTable.id });
  if (!survey) throw new Error('설문 생성 실패');

  await db.insert(questionsTable).values({
    surveyId: survey.id,
    type: 'radio',
    title: '질문 1',
    order: 1,
    questionCode: 'Q1',
    options: [{ id: 'o1', label: '예', value: 'o1' }],
  });
  return survey.id;
}

async function versionNumbers(surveyId: string): Promise<number[]> {
  const rows = await db
    .select({ versionNumber: surveyVersionsTable.versionNumber })
    .from(surveyVersionsTable)
    .where(eq(surveyVersionsTable.surveyId, surveyId))
    .orderBy(asc(surveyVersionsTable.versionNumber));
  return rows.map((r) => r.versionNumber);
}

describe.skipIf(!isLocalDb)('publishSurvey — 응답 없는 이전 버전 자동 정리 (real local DB)', () => {
  const createdSurveyIds: string[] = [];

  afterAll(async () => {
    for (const id of createdSurveyIds) {
      await db.delete(surveysTable).where(eq(surveysTable.id, id));
    }
  });

  it('재배포 시 응답이 없는 직전 버전은 삭제되고 최신 버전만 남는다', async () => {
    const surveyId = await createPublishableSurvey();
    createdSurveyIds.push(surveyId);

    await publishSurvey({ surveyId });
    const v2 = await publishSurvey({ surveyId });

    expect(await versionNumbers(surveyId)).toEqual([2]);

    const [survey] = await db
      .select({ currentVersionId: surveysTable.currentVersionId })
      .from(surveysTable)
      .where(eq(surveysTable.id, surveyId));
    expect(survey?.currentVersionId).toBe(v2.id);
  });

  it('응답(진행 중 포함)이 참조하는 이전 버전은 보존하고 versionNumber 는 단조 증가한다', async () => {
    const surveyId = await createPublishableSurvey();
    createdSurveyIds.push(surveyId);

    await publishSurvey({ surveyId }); // v1 — 응답 없음
    const v2 = await publishSurvey({ surveyId }); // v1 삭제, v2 활성

    // v2 에 진행 중 응답을 붙인다 (isCompleted=false 라도 보존 대상)
    await db.insert(surveyResponsesTable).values({
      surveyId,
      versionId: v2.id,
      questionResponses: {},
      sessionId: `prune-test-${surveyId}`,
    });

    const v3 = await publishSurvey({ surveyId }); // v2 는 응답 보유 → 보존

    expect(await versionNumbers(surveyId)).toEqual([2, 3]);
    expect(v3.versionNumber).toBe(3);

    // 보존된 v2 는 superseded 로 전환됐는지 (기존 동작 유지 확인)
    const [v2row] = await db
      .select({ status: surveyVersionsTable.status })
      .from(surveyVersionsTable)
      .where(eq(surveyVersionsTable.id, v2.id));
    expect(v2row?.status).toBe('superseded');
  });
});
