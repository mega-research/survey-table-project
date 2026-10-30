import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { questions as questionsTable, surveyResponses, surveys } from '@/db/schema';
import { applyExportRowExclusions } from '@/lib/analytics/export-exclusions';
import {
  type ScaleMeanCandidate,
  type ScaleMeanSummary,
  listScaleMeanCandidates,
  resolveScaleMeanSelection,
  summarizeScaleMeans,
} from '@/lib/operations/scale-mean-format';
import { normalizeQuestions } from '@/lib/question';
import { hydrateQuestionsForSpss } from '@/lib/spss/hydrate-questions';
import { type OperationsDataScope, responseScopeCondition } from '@/server/data-scope';
import { getQuestionGroupsBySurvey, mapGroupRow } from '@/server/read-models/survey-structure';
import { completedResponse, notDeletedResponse } from '@/server/response-filters';
import type { Question } from '@/types/survey';
import { resolveLanguageSetLocales } from '@/utils/survey-language';

import type { SetScaleMeanQuestionsInput, SetScaleMeanQuestionsResult } from '../domain/scale-mean';

/**
 * 척도 평균 (CONTEXT.md 「척도 평균」) — SQL 부. 순수 계산은 lib/operations/scale-mean-format.
 *
 * 화면 평균이 .sav 로 낸 평균과 같아야 하므로 구조·모수를 .sav 내보내기와 같게 읽는다.
 * - 구조는 발행 스냅샷이 아니라 **지금 빌더 구조**(내보내기 라우트와 같은 order 정렬 · hydrate ·
 *   일회성 행 제외 · 언어 묶음 공유 변수명). 그래서 「문항 선택」은 저장 즉시 반영된다.
 * - 모수는 완료(`status='completed'`) · 삭제 제외 · 운영 데이터 스코프(실/테스트).
 * - 복호화는 하지 않는다 — 척도 줄은 보기 선택값뿐이고 암호화 대상은 단답형·입력 칸이다.
 */
async function loadScaleMeanStructure(surveyId: string) {
  const rows = await db
    .select()
    .from(questionsTable)
    .where(eq(questionsTable.surveyId, surveyId))
    .orderBy(asc(questionsTable.order));
  const questions = applyExportRowExclusions(
    surveyId,
    hydrateQuestionsForSpss(normalizeQuestions(rows)),
  ) as unknown as Question[];
  const groups = await getQuestionGroupsBySurvey(surveyId);
  const languageSetLocales = resolveLanguageSetLocales(questions, groups.map(mapGroupRow));
  return { questions, languageSetLocales };
}

export interface ScaleMeanView {
  summary: ScaleMeanSummary;
  /** 「문항 선택」 목록 — 켜면 척도 줄이 생기는 문항 */
  candidates: ScaleMeanCandidate[];
}

export async function getScaleMeanView(
  surveyId: string,
  scope: OperationsDataScope,
): Promise<ScaleMeanView> {
  const { questions, languageSetLocales } = await loadScaleMeanStructure(surveyId);
  const candidates = listScaleMeanCandidates(questions, { languageSetLocales });

  // 켠 문항이 없으면 응답을 읽지 않는다 — 대부분의 설문이 여기서 끝난다.
  if (!candidates.some((c) => c.enabled)) {
    return { summary: { rows: [], overall: { kind: 'empty' } }, candidates };
  }

  const responses = await db
    .select({ questionResponses: surveyResponses.questionResponses })
    .from(surveyResponses)
    .where(
      and(
        eq(surveyResponses.surveyId, surveyId),
        notDeletedResponse,
        completedResponse,
        responseScopeCondition(scope),
      ),
    );

  const summary = summarizeScaleMeans(
    questions,
    responses.map((r) => ({
      questionResponses: (r.questionResponses ?? {}) as Record<string, unknown>,
    })),
    { languageSetLocales },
  );
  return { summary, candidates };
}

/**
 * 「문항 선택」 저장 — 고른 문항만 켜고 이 설문의 나머지 문항은 끈다.
 *
 * 결과 상태를 통째로 정하는 쓰기라 같은 요청을 다시 보내도 결과가 같다(멱등). 두 사람이 동시에
 * 저장하면 나중 문장이 이긴다 — 한 UPDATE 문장이라 반쯤 섞인 상태는 남지 않는다.
 * 문항 updated_at 은 건드리지 않는다 — 응답 화면·발행과 무관한 콘솔 설정이다.
 * 빌더 저장 경로는 이 컬럼을 싣지 않는다(CONSOLE_OWNED_QUESTION_FIELDS).
 */
export async function setScaleMeanQuestions(
  input: SetScaleMeanQuestionsInput,
): Promise<SetScaleMeanQuestionsResult> {
  const { surveyId } = input;
  const [survey] = await db
    .select({ id: surveys.id })
    .from(surveys)
    .where(and(eq(surveys.id, surveyId), isNull(surveys.deletedAt)));
  if (!survey) return { ok: false, error: '설문을 찾을 수 없습니다.' };

  const { questions, languageSetLocales } = await loadScaleMeanStructure(surveyId);
  const selection = resolveScaleMeanSelection(
    listScaleMeanCandidates(questions, { languageSetLocales }),
    input.questionIds,
  );
  if (!selection.ok) return { ok: false, error: selection.error };

  await db
    .update(questionsTable)
    .set({
      scaleMeanEnabled:
        selection.questionIds.length > 0
          ? inArray(questionsTable.id, selection.questionIds)
          : false,
    })
    .where(eq(questionsTable.surveyId, surveyId));
  return { ok: true };
}
