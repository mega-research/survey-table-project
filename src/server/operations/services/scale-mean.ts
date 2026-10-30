import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { questions as questionsTable, surveyResponses } from '@/db/schema';
import { completedResponse, notDeletedResponse } from '@/server/response-filters';
import { applyExportRowExclusions } from '@/lib/analytics/export-exclusions';
import { normalizeQuestions } from '@/lib/question';
import { hydrateQuestionsForSpss } from '@/lib/spss/hydrate-questions';
import type { Question } from '@/types/survey';
import { resolveLanguageSetLocales } from '@/utils/survey-language';

import { summarizeScaleMeans, type ScaleMeanSummary } from '@/lib/operations/scale-mean-format';
import { responseScopeCondition, type OperationsDataScope } from '@/server/data-scope';
import { getQuestionGroupsBySurvey, mapGroupRow } from '@/server/read-models/survey-structure';

/**
 * 척도 평균 (CONTEXT.md 「척도 평균」) — SQL 부. 순수 계산은 lib/operations/scale-mean-format.
 *
 * 화면 평균이 .sav 로 낸 평균과 같아야 하므로 구조·모수를 .sav 내보내기와 같게 읽는다.
 * - 구조는 발행 스냅샷이 아니라 **지금 빌더 구조**(내보내기 라우트와 같은 order 정렬 · hydrate ·
 *   일회성 행 제외 · 언어 묶음 공유 변수명). 그래서 「척도 평균에 넣기」는 저장 즉시 반영된다.
 * - 모수는 완료(`status='completed'`) · 삭제 제외 · 운영 데이터 스코프(실/테스트).
 * - 복호화는 하지 않는다 — 척도 줄은 보기 선택값뿐이고 암호화 대상은 단답형·입력 칸이다.
 */
export async function getScaleMeanSummary(
  surveyId: string,
  scope: OperationsDataScope,
): Promise<ScaleMeanSummary> {
  const rows = await db
    .select()
    .from(questionsTable)
    .where(eq(questionsTable.surveyId, surveyId))
    .orderBy(asc(questionsTable.order));

  // 켠 문항이 없으면 응답을 읽지 않는다 — 대부분의 설문이 여기서 끝난다.
  if (!rows.some((row) => row.scaleMeanEnabled)) {
    return { rows: [], overall: { kind: 'empty' } };
  }

  const questions = applyExportRowExclusions(
    surveyId,
    hydrateQuestionsForSpss(normalizeQuestions(rows)),
  ) as unknown as Question[];
  const groups = await getQuestionGroupsBySurvey(surveyId);
  const languageSetLocales = resolveLanguageSetLocales(questions, groups.map(mapGroupRow));

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

  return summarizeScaleMeans(
    questions,
    responses.map((r) => ({
      questionResponses: (r.questionResponses ?? {}) as Record<string, unknown>,
    })),
    { languageSetLocales },
  );
}
