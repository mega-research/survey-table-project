/**
 * surveyBuilder procedure 실 DB 왕복 integration test
 *
 * 목적: procedure -> service -> 실 PostgreSQL 왕복(설문 생성 + diff 저장 + publish)이
 * 실제로 돈다는 것을 CI에 고정. publish 불변식(C)을 실DB에서 검증한다:
 *   - survey_versions.versionNumber = 1
 *   - survey_versions.status = 'published'
 *   - snapshot.questions 길이 = 1 (saveDiff 가 upsert 한 질문이 스냅샷에 반영)
 *   - surveys.currentVersionId = 새 version.id
 *
 * 실행 조건: DATABASE_URL이 127.0.0.1 또는 localhost를 포함할 때만 동작.
 * prod URL 환경에서는 describe.skipIf로 전체 스킵 -> 일반 pnpm test에서 데이터 오염 없음.
 *
 * R2 회피: promoteSurveyImages/promoteNoticeAttachments 는 tmp/ 접두 URL 이 있을 때만
 * R2 를 호출한다. 평문(이미지/첨부 없는) 질문으로 round-trip 해 R2 의존을 타지 않는다.
 * 빌더 경로는 next/headers 를 쓰지 않으므로 mock 불필요.
 */

import { createRouterClient } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { db } from '@/db';
import {
  questions as questionsTable,
  surveys as surveysTable,
  surveyVersions as surveyVersionsTable,
} from '@/db/schema';
import type { ORPCContext } from '@/server/context';

import { save } from '@/features/survey-builder/server/procedures/save';
import { publish } from '@/features/survey-builder/server/procedures/publish';
import { surveys } from '@/features/survey-builder/server/procedures/surveys';

const dbUrl = process.env['DATABASE_URL'] ?? '';
const isLocalDb = dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost');

function authedContext(): ORPCContext {
  return {
    db,
    supabase: {} as never,
    user: { id: 'admin-roundtrip', email: 'admin@example.com' },
  };
}

describe.skipIf(!isLocalDb)('surveyBuilder procedure round-trip (real local DB)', () => {
  const client = createRouterClient({ surveys, save, publish }, { context: authedContext() });
  const createdSurveyIds: string[] = [];

  afterAll(async () => {
    for (const id of createdSurveyIds) {
      // survey 삭제 시 questions/survey_versions 는 FK cascade 로 정리된다.
      await db.delete(surveysTable).where(eq(surveysTable.id, id));
    }
  });

  it('create -> saveDiff(질문 1개 upsert) -> publish 왕복: 버전/스냅샷/currentVersionId가 DB에 반영된다', async () => {
    // 1. create: 새 설문 행 생성
    const created = await client.surveys.create({ title: '빌더-왕복-테스트-설문' });
    expect(typeof created.id).toBe('string');
    const surveyId = created.id;
    createdSurveyIds.push(surveyId);

    // 2. saveDiff: 평문 질문 1개 upsert (이미지/첨부 없음 -> R2 회피)
    const questionId = crypto.randomUUID();
    const saved = await client.save.saveDiff({
      surveyId,
      questionChanges: {
        upserted: [
          {
            id: questionId,
            type: 'text',
            title: '이름을 입력하세요',
            required: false,
            order: 1,
          },
        ] as never,
        deleted: [],
      },
    });
    expect(saved).toEqual({ surveyId });

    // 질문이 DB 에 실제로 들어갔는지 확인
    const [questionRow] = await db
      .select({ id: questionsTable.id })
      .from(questionsTable)
      .where(eq(questionsTable.id, questionId));
    expect(questionRow?.id).toBe(questionId);

    // 3. publish: 단일 트랜잭션 (published 1개 보장 + versionNumber=max+1 + currentVersionId 갱신)
    const version = await client.publish.publish({ surveyId, changeNote: '첫 배포' });
    expect(version.versionNumber).toBe(1);
    expect(version.status).toBe('published');

    // 4. survey_versions 검증: versionNumber/status/snapshot.questions 길이
    const [versionRow] = await db
      .select({
        id: surveyVersionsTable.id,
        versionNumber: surveyVersionsTable.versionNumber,
        status: surveyVersionsTable.status,
        snapshot: surveyVersionsTable.snapshot,
      })
      .from(surveyVersionsTable)
      .where(eq(surveyVersionsTable.id, version.id));
    expect(versionRow?.versionNumber).toBe(1);
    expect(versionRow?.status).toBe('published');
    expect(versionRow?.snapshot.questions.length).toBe(1);
    expect(versionRow?.snapshot.questions[0]?.id).toBe(questionId);

    // 5. surveys.currentVersionId 가 새 버전을 가리키는지 검증 (불변식 C)
    const [surveyRow] = await db
      .select({
        currentVersionId: surveysTable.currentVersionId,
        status: surveysTable.status,
      })
      .from(surveysTable)
      .where(eq(surveysTable.id, surveyId));
    expect(surveyRow?.currentVersionId).toBe(version.id);
    expect(surveyRow?.status).toBe('published');
  });
});
