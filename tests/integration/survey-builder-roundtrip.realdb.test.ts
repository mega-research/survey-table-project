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
import { isSlugAvailable } from '@/features/survey-builder/server/services/survey-read.service';

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

  // 회귀: duplicateSurvey 의 질문 매핑이 SPSS/단답형/선택개수 컬럼 10개를 누락하지 않아야 한다.
  // 과거 매핑이 minSelections/maxSelections/questionCode/isCustomSpssVarName/exportLabel/
  // spssVarType/spssMeasure/defaultValueTemplate/inputType/emptyDefault 를 빠뜨려 복제본에서
  // 해당 설정이 소실되던 버그(H3).
  it('duplicate: 질문의 SPSS/단답형/선택개수 컬럼 10개가 복제본에 보존된다', async () => {
    // 1. 원본 설문 생성
    const original = await client.surveys.create({ title: '복제-컬럼보존-원본' });
    createdSurveyIds.push(original.id);

    // 2. 10개 컬럼을 모두 기본값과 다른 값으로 채운 질문을 DB 에 직접 삽입.
    //    saveDiff 입력 스키마는 defaultValueTemplate/inputType/emptyDefault 를 포함하지 않으므로
    //    duplicateSurvey 매핑만 검증하기 위해 직접 insert 한다.
    const originalQuestionId = crypto.randomUUID();
    await db.insert(questionsTable).values({
      id: originalQuestionId,
      surveyId: original.id,
      type: 'checkbox',
      title: '컬럼 보존 검증 질문',
      order: 1,
      minSelections: 2,
      maxSelections: 5,
      questionCode: 'Q42',
      isCustomSpssVarName: true,
      exportLabel: '내보내기 라벨',
      spssVarType: 'String',
      spssMeasure: 'Ordinal',
      defaultValueTemplate: '{{attrs_name}}',
      inputType: 'number',
      emptyDefault: 7.5,
    });

    // 3. 복제 실행
    const copy = await client.surveys.duplicate({ surveyId: original.id });
    expect(copy).not.toBeNull();
    if (!copy) throw new Error('duplicate 가 null 을 반환했다');
    createdSurveyIds.push(copy.id);

    // 4. 복제본 질문 행을 읽어 10개 컬럼이 모두 보존됐는지 검증
    const [copiedQuestion] = await db
      .select({
        minSelections: questionsTable.minSelections,
        maxSelections: questionsTable.maxSelections,
        questionCode: questionsTable.questionCode,
        isCustomSpssVarName: questionsTable.isCustomSpssVarName,
        exportLabel: questionsTable.exportLabel,
        spssVarType: questionsTable.spssVarType,
        spssMeasure: questionsTable.spssMeasure,
        defaultValueTemplate: questionsTable.defaultValueTemplate,
        inputType: questionsTable.inputType,
        emptyDefault: questionsTable.emptyDefault,
      })
      .from(questionsTable)
      .where(eq(questionsTable.surveyId, copy.id));

    expect(copiedQuestion).toBeDefined();
    expect(copiedQuestion?.minSelections).toBe(2);
    expect(copiedQuestion?.maxSelections).toBe(5);
    expect(copiedQuestion?.questionCode).toBe('Q42');
    expect(copiedQuestion?.isCustomSpssVarName).toBe(true);
    expect(copiedQuestion?.exportLabel).toBe('내보내기 라벨');
    expect(copiedQuestion?.spssVarType).toBe('String');
    expect(copiedQuestion?.spssMeasure).toBe('Ordinal');
    expect(copiedQuestion?.defaultValueTemplate).toBe('{{attrs_name}}');
    expect(copiedQuestion?.inputType).toBe('number');
    expect(copiedQuestion?.emptyDefault).toBe(7.5);
  });

  // 회귀: isSlugAvailable 의 excludeSurveyId 는 "자기 자신을 제외"하는 의미여야 한다(ne).
  // eq 로 매칭하면 자기 슬러그 유지 저장이 중복으로 막히고, 실제 타 설문 중복은 통과되던 버그.
  it('isSlugAvailable: excludeSurveyId 는 자기 자신을 슬러그 충돌 검사에서 제외한다', async () => {
    const slug = `slug-회귀-${crypto.randomUUID()}`;

    // 슬러그를 점유한 설문 A 생성
    const surveyA = await client.surveys.create({ title: '슬러그-점유-A' });
    createdSurveyIds.push(surveyA.id);
    await db.update(surveysTable).set({ slug }).where(eq(surveysTable.id, surveyA.id));

    // 1) exclude 없이: 다른 설문이 이미 그 슬러그를 쓰므로 사용 불가
    expect(await isSlugAvailable({ slug })).toBe(false);

    // 2) 자기 자신(A) 제외: 자기 슬러그를 유지하는 저장은 허용되어야 한다
    expect(await isSlugAvailable({ slug, excludeSurveyId: surveyA.id })).toBe(true);

    // 3) 무관한 다른 설문(B) 제외: A 가 여전히 점유 중이므로 사용 불가가 유지되어야 한다
    const surveyB = await client.surveys.create({ title: '슬러그-무관-B' });
    createdSurveyIds.push(surveyB.id);
    expect(await isSlugAvailable({ slug, excludeSurveyId: surveyB.id })).toBe(false);
  });

  // 회귀: 링크 재발급(regeneratePrivateToken). saveDiff 의 metadata.privateToken 변경분이
  // surveys.private_token 컬럼에 반영되어야 옛 링크가 무효화된다.
  // 과거 saveSurveyDiff 의 metadata .set() 에 privateToken 이 빠져 새 토큰이 영속되지 않아
  // 기존 링크가 계속 유효하던 버그(H21).
  it('saveDiff: metadata.privateToken 변경분이 surveys.private_token 에 반영된다', async () => {
    const created = await client.surveys.create({ title: '토큰-재발급-회귀' });
    createdSurveyIds.push(created.id);
    const surveyId = created.id;

    // 생성 시 defaultRandom 으로 발번된 기존 토큰을 읽어 둔다.
    const [before] = await db
      .select({ privateToken: surveysTable.privateToken })
      .from(surveysTable)
      .where(eq(surveysTable.id, surveyId));
    const oldToken = before?.privateToken;
    expect(typeof oldToken).toBe('string');

    // 링크 재발급에 해당하는 새 토큰을 metadata 에 실어 saveDiff 호출.
    const newToken = crypto.randomUUID();
    expect(newToken).not.toBe(oldToken);

    await client.save.saveDiff({
      surveyId,
      metadata: {
        title: '토큰-재발급-회귀',
        privateToken: newToken,
        settings: {
          isPublic: false,
          allowMultipleResponses: false,
          showProgressBar: true,
          shuffleQuestions: false,
          requireLogin: false,
          thankYouMessage: '감사합니다',
        },
      },
    } as never);

    // DB 의 private_token 이 새 토큰으로 갱신되었는지 검증(옛 링크 무효화).
    const [after] = await db
      .select({ privateToken: surveysTable.privateToken })
      .from(surveysTable)
      .where(eq(surveysTable.id, surveyId));
    expect(after?.privateToken).toBe(newToken);
    expect(after?.privateToken).not.toBe(oldToken);
  });
});
