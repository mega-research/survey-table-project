import { cache } from 'react';

import { asc, eq } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { questions } from '@/db/schema';
import { surveys } from '@/db/schema/surveys';
import type { AnswerChoiceMap } from '@/lib/operations/profile-answer-choices';
import { buildProfileAnswerModel } from '@/lib/operations/profile-answer-sources';
import { normalizeQuestions } from '@/lib/question';
import { hydrateQuestionsForSpss } from '@/lib/spss/hydrate-questions';
import { normalizePassParamNames } from '@/lib/survey/end-redirect';
import type { ProfileColumnScheme } from '@/shared/contracts/operations';
import type { ProfileAnswerSource } from '@/shared/contracts/operations-io';

/**
 * surveys.profile_columns 캐시 (RSC pass 내 dedupe).
 * NULL 이면 null 반환 — 호출자가 hydrateProfileColumns 로 기본 스킴 생성.
 */
export const getProfileColumnScheme = cache(
  async (surveyId: string): Promise<ProfileColumnScheme | null> => {
    const [row] = await db
      .select({ scheme: surveys.profileColumns })
      .from(surveys)
      .where(eq(surveys.id, surveyId))
      .limit(1);
    return row?.scheme ?? null;
  },
);

/**
 * 응답 내역 entry.* 열의 이름 — 종료 후 이동 주소 설정의 이어 넘길 값(passParams).
 * 설정이 없으면 빈 배열이라 열도 검색 후보도 생기지 않는다.
 */
export const getProfileEntryParamNames = cache(async (surveyId: string): Promise<string[]> => {
  const [row] = await db
    .select({ endRedirects: surveys.endRedirects })
    .from(surveys)
    .where(eq(surveys.id, surveyId))
    .limit(1);
  return normalizePassParamNames(row?.endRedirects?.passParams);
});

/**
 * 응답 내역 응답값 열 모델 — 후보 목록과 보기 열의 보기 목록. 지금 빌더 구조에서 만든다
 * (lib/operations/profile-answer-sources). 같은 요청 안에서 후보·보기 목록 두 조회가 한 번만 읽는다.
 */
const loadProfileAnswerModel = cache(async (surveyId: string) => {
  // 내보내기와 같은 변수 순서가 되도록 문항 순서대로 읽는다.
  const rows = await db
    .select()
    .from(questions)
    .where(eq(questions.surveyId, surveyId))
    .orderBy(asc(questions.order), asc(questions.id));
  const prepared = hydrateQuestionsForSpss(normalizeQuestions(rows));
  const encryptedQuestionIds = new Set(rows.filter((r) => r.piiEncrypted).map((r) => r.id));
  return buildProfileAnswerModel(prepared, encryptedQuestionIds);
});

/**
 * 응답 내역 응답값 열로 고를 수 있는 칸 — 단답형·장문형 문항, 표 입력 칸, 보기 문항, 표의 선택 칸.
 * 변수명은 Raw 내보내기와 같은 규칙으로 만들어 목록에서 `Q1_r1_c2` 로 찾을 수 있게 하고,
 * 저장은 바뀌지 않는 문항·칸 id 로 한다(answerColumnKey).
 */
export const getProfileAnswerSources = cache(
  async (surveyId: string): Promise<ProfileAnswerSource[]> =>
    (await loadProfileAnswerModel(surveyId)).sources,
);

/** 보기 열(응답값 열 키) → 보기 목록 — 목록 칸 글자와 검색·깔때기가 같은 목록을 쓴다. */
export const getProfileAnswerChoices = cache(
  async (surveyId: string): Promise<AnswerChoiceMap> => (await loadProfileAnswerModel(surveyId)).choices,
);
