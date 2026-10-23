/**
 * Raw 내보내기 마지막 그물 — 개인정보로 암호화된 명단 열을 읽는 표시 조건을 응답 확정과 같은 명단 값으로 푼다.
 *
 * 응답 화면·응답 확정은 명단 값에 개인정보 열의 복호화 값을 합친다(respondent-contact-attrs). 내보내기가
 * `contact_targets.attrs` 만으로 풀면 `사업자등록번호` 가 없는 열이 되고, 없는 명단 열을 읽는 비교는
 * 보이는 쪽으로 풀린다(branch-logic 의 fail-safe SHOW). 그래서 화면에서 숨어 있던 문항의 남은 값이
 * 진행 중 응답의 Raw 파일에 그대로 실린다. 서식도 응답 화면과 같아야 한다 — 사업자번호는 하이픈을 넣은
 * `123-45-67890` 으로 비교된다.
 *
 * 실행: pnpm test:integration (로컬 supabase 54322 필요)
 */
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { loadRawExportRows } from '@/app/api/surveys/[surveyId]/export/raw-export-load';
import { db } from '@/db';
import { contactPii, contactTargets, surveyResponses, surveys, surveyVersions } from '@/db/schema';
import { buildPiiRows } from '@/lib/crypto/contact-pii-repo';
import type { QuestionData, SurveyVersionSnapshot } from '@/shared/contracts/survey';

const isLocalDb =
  (process.env['DATABASE_URL'] ?? '').includes('127.0.0.1') ||
  (process.env['DATABASE_URL'] ?? '').includes('localhost');

const createdSurveyIds: string[] = [];

/** 명단의 사업자등록번호(개인정보로 암호화된 열)가 `value` 일 때만 보이는 문항. */
const shownForBiz = (id: string, order: number, value: string): QuestionData => ({
  id,
  type: 'text',
  title: `사업자 ${value} 확인 문항`,
  required: false,
  order,
  displayCondition: {
    logicType: 'AND',
    conditions: [
      {
        id: `${id}-c1`,
        enabled: true,
        logicType: 'AND',
        conditionType: 'expression',
        sourceQuestionId: '',
        expressionConfig: {
          clauses: [
            {
              kind: 'comparison',
              comparison: {
                op: '==',
                left: { kind: 'attr', attrsKey: '사업자등록번호' },
                right: { kind: 'literal', value },
              },
            },
          ],
          joinOps: [],
        },
      },
    ],
  } as unknown as NonNullable<QuestionData['displayCondition']>,
});

function buildSnapshot(questions: QuestionData[]): SurveyVersionSnapshot {
  return {
    title: '내보내기 개인정보 열 조건',
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

async function seed() {
  const [survey] = await db
    .insert(surveys)
    .values({ title: '내보내기 개인정보 열 조건 왕복', status: 'published' })
    .returning();
  if (!survey) throw new Error('설문 시드 실패');
  createdSurveyIds.push(survey.id);

  const [version] = await db
    .insert(surveyVersions)
    .values({
      surveyId: survey.id,
      versionNumber: 1,
      status: 'published',
      snapshot: buildSnapshot([
        { id: 'q-first', type: 'text', title: '첫 문항', required: false, order: 0 },
        // 명단 값과 같은 서식 — 화면에서 보이는 문항
        shownForBiz('q-shown', 1, '123-45-67890'),
        // 다른 번호 — 화면에서 숨은 문항(초안 저장은 strip 하지 않아 숨기 전 값이 남아 있다)
        shownForBiz('q-hidden', 2, '999-99-99999'),
      ]),
      publishedAt: new Date(),
    })
    .returning();
  if (!version) throw new Error('버전 시드 실패');
  await db.update(surveys).set({ currentVersionId: version.id }).where(eq(surveys.id, survey.id));

  const contactId = randomUUID();
  await db
    .insert(contactTargets)
    .values({ id: contactId, surveyId: survey.id, resid: 1, inviteCode: randomUUID(), attrs: { 기업명: '가나' } });
  await db
    .insert(contactPii)
    .values(buildPiiRows(contactId, [{ columnKey: '사업자등록번호', fieldType: 'biz_number', plain: '1234567890' }]));

  const [response] = await db
    .insert(surveyResponses)
    .values({
      surveyId: survey.id,
      versionId: version.id,
      sessionId: `seed-${randomUUID()}`,
      status: 'in_progress',
      isCompleted: false,
      contactTargetId: contactId,
      questionResponses: {
        'q-first': '첫 답',
        'q-shown': '화면에서 보고 적은 답',
        'q-hidden': '숨기 전에 남은 값',
      },
    })
    .returning();
  if (!response) throw new Error('응답 시드 실패');

  return { surveyId: survey.id, responseId: response.id };
}

describe.skipIf(!isLocalDb)('Raw 내보내기 개인정보 열 조건 실DB 왕복', () => {
  afterAll(async () => {
    if (createdSurveyIds.length === 0) return;
    await db.delete(surveyResponses).where(inArray(surveyResponses.surveyId, createdSurveyIds));
    await db.delete(contactTargets).where(inArray(contactTargets.surveyId, createdSurveyIds));
    await db.update(surveys).set({ currentVersionId: null }).where(inArray(surveys.id, createdSurveyIds));
    await db.delete(surveyVersions).where(inArray(surveyVersions.surveyId, createdSurveyIds));
    await db.delete(surveys).where(inArray(surveys.id, createdSurveyIds));
  });

  it('개인정보 열을 읽는 표시 조건을 응답 화면 서식으로 풀어 숨은 문항의 남은 값만 뺀다', async () => {
    const { surveyId, responseId } = await seed();

    const result = await loadRawExportRows(surveyId, 'real', { includeNonRespondents: false });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const row = result.rows.find((r) => r.id === responseId);
    expect(row?.questionResponses).toEqual({ 'q-first': '첫 답', 'q-shown': '화면에서 보고 적은 답' });
    // 판정에만 쓴 개인정보 평문은 명단 열을 고르지 않은 파일에 실리지 않는다.
    expect(row?.contactValues).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain('1234567890');
    expect(JSON.stringify(row)).not.toContain('123-45-67890');
  });
});
