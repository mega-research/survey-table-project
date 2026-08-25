import { randomUUID } from 'node:crypto';

import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import postgres from 'postgres';

import * as schema from '@/db/schema';
import type { SurveyVersionSnapshot } from '@/shared/contracts/survey';
import { buildSurveySnapshot } from '@/server/survey-builder/services/versioning/snapshot-builder';
import type { Question, Survey } from '@/types/survey';

/**
 * 응답자 경로 e2e 시드 — postgres-js 직접 INSERT + cascade 정리.
 *
 * 스냅샷은 손으로 조립하지 않고 publish 가 쓰는 buildSurveySnapshot 을 그대로 통과시켜
 * 만든다 — 스냅샷 어휘가 바뀌면 이 시드도 같은 커밋에서 함께 깨지는 것이 의도다.
 * 질문 rows 도 함께 넣는 이유는 saveResponse 가 채우는 response_answers 의
 * questionId 참조 때문이다 (응답 페이지 자체는 스냅샷만 읽는다).
 */

// playwright.config 가 process.env 에 확정해 둔 로컬 supabase 테스트 DB(realdb 스위트와 동일).
// 여기서 기본값을 중복 하드코딩하면 config 와 드리프트할 수 있어 부재는 실패로 처리한다.
const connectionString = process.env['E2E_DATABASE_URL'];
if (!connectionString) throw new Error('E2E_DATABASE_URL 미설정 — playwright.config 를 거치지 않은 실행이다');

const client = postgres(connectionString, { prepare: false, max: 2 });
const db = drizzle(client, { schema });

export interface RespondentSeed {
  surveyId: string;
  privateToken: string;
  inviteToken: string;
  contactTargetId: string;
  versionId: string;
  thankYouMessage: string;
  ids: {
    radioQuestion: string;
    otherOption: string;
    textQuestion: string;
    tableQuestion: string;
    inputCell: string;
    radioCell: string;
  };
}

export interface SeedOptions {
  /** false = 실사 구성(비공개 설문 + 초대 필수 경로). 익명 시나리오만 true 가 필요하다. */
  isPublic?: boolean;
}

export async function seedRespondentSurvey(options: SeedOptions = {}): Promise<RespondentSeed> {
  const isPublic = options.isPublic ?? false;
  const surveyId = randomUUID();
  const privateToken = randomUUID();
  const inviteToken = randomUUID();
  const versionId = randomUUID();
  const contactTargetId = randomUUID();
  const thankYouMessage = '참여해 주셔서 감사합니다 — e2e 시드';

  const ids = {
    radioQuestion: randomUUID(),
    otherOption: randomUUID(),
    textQuestion: randomUUID(),
    tableQuestion: randomUUID(),
    inputCell: randomUUID(),
    radioCell: randomUUID(),
  };

  const now = new Date();

  const questions: Question[] = [
    {
      id: ids.radioQuestion,
      type: 'radio',
      title: '전반적으로 얼마나 만족하십니까?',
      description: '',
      required: true,
      order: 0,
      options: [
        { id: `${ids.radioQuestion}-good`, value: '1', label: '매우 만족' },
        { id: ids.otherOption, value: 'other', label: '기타', allowTextInput: true },
      ],
    },
    {
      id: ids.textQuestion,
      type: 'text',
      title: '자유 의견을 남겨 주세요',
      description: '',
      required: false,
      order: 1,
    },
    {
      id: ids.tableQuestion,
      type: 'table',
      title: '항목별 평가',
      description: '',
      required: false,
      order: 2,
      tableColumns: [
        { id: 'col-input', label: '수치 입력' },
        { id: 'col-choice', label: '수행 여부' },
      ],
      tableRowsData: [
        {
          id: 'row-1',
          label: '항목 1',
          cells: [
            { id: ids.inputCell, type: 'input', content: '' },
            {
              id: ids.radioCell,
              type: 'radio',
              content: '',
              radioOptions: [
                { id: `${ids.radioCell}-y`, label: '수행', value: '1' },
                { id: `${ids.radioCell}-n`, label: '미수행', value: '2' },
              ],
            },
          ],
        },
      ],
    },
  ];

  const survey: Survey = {
    id: surveyId,
    title: 'e2e 응답자 경로 시드',
    privateToken,
    status: 'published',
    questions,
    groups: [],
    settings: {
      // 익명(비초대) 제출은 공개 설문에서만 허용된다 — acceptance 의 invite_required 판정
      // (isPublic false && contact 없음 → invalid_token). privateToken 진입은 공개 여부와 무관.
      isPublic,
      allowMultipleResponses: false,
      showProgressBar: true,
      shuffleQuestions: false,
      requireLogin: false,
      thankYouMessage,
    },
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(schema.surveys).values({
    id: surveyId,
    title: survey.title,
    privateToken,
    isPublic,
    allowMultipleResponses: false,
    showProgressBar: true,
    shuffleQuestions: false,
    requireLogin: false,
    thankYouMessage,
    status: 'published',
  });

  await db.insert(schema.questions).values(
    questions.map((q) => ({
      id: q.id,
      surveyId,
      type: q.type,
      title: q.title,
      description: q.description ?? null,
      required: q.required,
      order: q.order,
      options: q.options ?? null,
      tableColumns: q.tableColumns ?? null,
      tableRowsData: q.tableRowsData ?? null,
    })),
  );

  await db.insert(schema.surveyVersions).values({
    id: versionId,
    surveyId,
    versionNumber: 1,
    status: 'published',
    // SurveySnapshot ↔ SurveyVersionSnapshot 은 런타임 동형(차이는 exactOptional 수식자뿐) —
    // survey-publish.ts 의 동일 캐스트 선례를 따른다.
    snapshot: buildSurveySnapshot(survey) as SurveyVersionSnapshot,
    publishedAt: now,
  });

  await db.update(schema.surveys).set({ currentVersionId: versionId }).where(eq(schema.surveys.id, surveyId));

  await db.insert(schema.contactTargets).values({
    id: contactTargetId,
    surveyId,
    resid: 1,
    isTest: false,
    attrs: { 이름: 'e2e 대상자' },
    inviteToken,
    inviteCode: `e2e-${randomUUID().slice(0, 12)}`,
  });

  return { surveyId, privateToken, inviteToken, contactTargetId, versionId, thankYouMessage, ids };
}

export async function fetchResponses(surveyId: string) {
  return db
    .select()
    .from(schema.surveyResponses)
    .where(eq(schema.surveyResponses.surveyId, surveyId));
}

export async function fetchResponseAnswers(responseId: string) {
  return db
    .select()
    .from(schema.responseAnswers)
    .where(eq(schema.responseAnswers.responseId, responseId));
}

export async function fetchContactTarget(contactTargetId: string) {
  const rows = await db
    .select()
    .from(schema.contactTargets)
    .where(eq(schema.contactTargets.id, contactTargetId));
  return rows[0] ?? null;
}

/** 시드 역순 정리 — 양방향 contact↔response FK 가 ON DELETE SET NULL 인 전제의 순서다(0014). */
export async function cleanupSeed(surveyId: string): Promise<void> {
  const responses = await db
    .select({ id: schema.surveyResponses.id })
    .from(schema.surveyResponses)
    .where(eq(schema.surveyResponses.surveyId, surveyId));
  const responseIds = responses.map((r) => r.id);

  if (responseIds.length > 0) {
    await db.delete(schema.responseAnswers).where(inArray(schema.responseAnswers.responseId, responseIds));
    await db
      .delete(schema.testResponseAttempts)
      .where(inArray(schema.testResponseAttempts.responseId, responseIds));
  }
  await db.delete(schema.contactTargets).where(eq(schema.contactTargets.surveyId, surveyId));
  await db.delete(schema.surveyResponses).where(eq(schema.surveyResponses.surveyId, surveyId));
  await db.update(schema.surveys).set({ currentVersionId: null }).where(eq(schema.surveys.id, surveyId));
  await db.delete(schema.surveyVersions).where(eq(schema.surveyVersions.surveyId, surveyId));
  await db.delete(schema.questions).where(eq(schema.questions.surveyId, surveyId));
  await db.delete(schema.surveys).where(eq(schema.surveys.id, surveyId));
}

export async function closeSeedDb(): Promise<void> {
  await client.end();
}
