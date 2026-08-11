/**
 * publish 시 응답 없는 이전 버전 스냅샷 자동 정리 — 실 DB 검증
 *
 * 배경: survey_versions.snapshot 이 publish 마다 통째로 쌓여 DB 절반 이상을
 * 차지했다(2026-08-10 프로덕션 일회성 정리 선례). publishSurvey 가 새 버전을
 * 만든 뒤, 같은 설문의 이전 버전 중 보존 규칙에 미달하는 버전을 트랜잭션
 * 안에서 정리해 다시 쌓이지 않게 한다.
 *
 * 정리 방식 (2026-08-11 병합에서 hard delete 를 대체): 행은 남기고 snapshot
 * 만 NULL 로 비운다 + prunedAt 기록. 행 유지는 survey_responses.version_id
 * 참조 무결성(FK 부재) 때문이고, 비우기 전에 스냅샷의 R2 키를 유예 삭제
 * 큐에 등록하며 참조 인덱스(r2_key_refs)도 같은 트랜잭션에서 해제한다.
 * (2026-07-31 spec 5.2·5.4)
 *
 * 보존 불변식 (하위 두 가드는 2026-08-10 일회성 정리와 동일):
 *   - 살아있는 비테스트 응답(진행 중 포함)이 참조하는 버전은 보존 — 응답
 *     수정 calc 재계산·운영 집계·이전 버전 진행 중 응답 검증이 스냅샷을 읽는다
 *   - 방금 만든 버전(= currentVersionId)은 보존
 *   - 행이 남으므로 versionNumber 는 자연히 재사용 없이 단조 증가
 *
 * 실행 조건: 로컬 DB(127.0.0.1/localhost)에서만. pnpm test:integration.
 * (로컬 supabase 에 0070·0071 적용 필요)
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

interface VersionState {
  versionNumber: number;
  snapshotIsNull: boolean;
  pruned: boolean;
}

async function versionStates(surveyId: string): Promise<VersionState[]> {
  const rows = await db
    .select({
      versionNumber: surveyVersionsTable.versionNumber,
      snapshot: surveyVersionsTable.snapshot,
      prunedAt: surveyVersionsTable.prunedAt,
    })
    .from(surveyVersionsTable)
    .where(eq(surveyVersionsTable.surveyId, surveyId))
    .orderBy(asc(surveyVersionsTable.versionNumber));
  return rows.map((r) => ({
    versionNumber: r.versionNumber,
    snapshotIsNull: r.snapshot === null,
    pruned: r.prunedAt !== null,
  }));
}

describe.skipIf(!isLocalDb)('publishSurvey — 응답 없는 이전 버전 자동 정리 (real local DB)', () => {
  const createdSurveyIds: string[] = [];

  afterAll(async () => {
    for (const id of createdSurveyIds) {
      await db.delete(surveyResponsesTable).where(eq(surveyResponsesTable.surveyId, id));
      await db.update(surveysTable).set({ currentVersionId: null }).where(eq(surveysTable.id, id));
      await db.delete(surveyVersionsTable).where(eq(surveyVersionsTable.surveyId, id));
      await db.delete(surveysTable).where(eq(surveysTable.id, id));
    }
  });

  it('재배포 시 응답이 없는 직전 버전은 snapshot 이 비워지고 행은 남는다', async () => {
    const surveyId = await createPublishableSurvey();
    createdSurveyIds.push(surveyId);

    await publishSurvey({ surveyId });
    const v2 = await publishSurvey({ surveyId });

    // 행은 둘 다 남고, v1 만 정리된다 — versionNumber 는 자연히 단조 증가
    expect(await versionStates(surveyId)).toEqual([
      { versionNumber: 1, snapshotIsNull: true, pruned: true },
      { versionNumber: 2, snapshotIsNull: false, pruned: false },
    ]);

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
    const v2 = await publishSurvey({ surveyId }); // v1 정리, v2 활성

    // v2 에 진행 중 응답을 붙인다 (isCompleted=false 라도 살아있는 비테스트 응답 = 보존 대상)
    await db.insert(surveyResponsesTable).values({
      surveyId,
      versionId: v2.id,
      questionResponses: {},
      sessionId: `prune-test-${surveyId}`,
    });

    const v3 = await publishSurvey({ surveyId }); // v2 는 응답 보유 → 보존

    expect(await versionStates(surveyId)).toEqual([
      { versionNumber: 1, snapshotIsNull: true, pruned: true },
      { versionNumber: 2, snapshotIsNull: false, pruned: false },
      { versionNumber: 3, snapshotIsNull: false, pruned: false },
    ]);
    expect(v3.versionNumber).toBe(3);

    // 보존된 v2 는 superseded 로 전환됐는지 (기존 동작 유지 확인)
    const [v2row] = await db
      .select({ status: surveyVersionsTable.status })
      .from(surveyVersionsTable)
      .where(eq(surveyVersionsTable.id, v2.id));
    expect(v2row?.status).toBe('superseded');
  });
});
