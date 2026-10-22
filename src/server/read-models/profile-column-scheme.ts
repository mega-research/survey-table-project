import { cache } from 'react';

import { asc, eq } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { questions } from '@/db/schema';
import { surveys } from '@/db/schema/surveys';
import { generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
import { answerColumnKey } from '@/lib/operations/profile-columns-format';
import { normalizeQuestions } from '@/lib/question';
import { hydrateQuestionsForSpss } from '@/lib/spss/hydrate-questions';
import { normalizePassParamNames } from '@/lib/survey/end-redirect';
import type { ProfileColumnScheme } from '@/shared/contracts/operations';
import type { ProfileAnswerSource } from '@/shared/contracts/operations-io';
import { tableInputCellLabels } from '@/utils/table-input-cell-labels';

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
 * 응답 내역 응답값 열로 고를 수 있는 칸 — 지금 빌더 구조의 단답형·장문형 문항과 표 입력 칸.
 * 변수명은 Raw 내보내기와 같은 규칙(generateSPSSColumns)으로 만들어 목록에서 `Q1_r1_c2` 로
 * 찾을 수 있게 하고, 저장은 바뀌지 않는 문항·칸 id 로 한다(answerColumnKey).
 */
export const getProfileAnswerSources = cache(
  async (surveyId: string): Promise<ProfileAnswerSource[]> => {
    // 내보내기와 같은 변수 순서가 되도록 문항 순서대로 읽는다.
    const rows = await db
      .select()
      .from(questions)
      .where(eq(questions.surveyId, surveyId))
      .orderBy(asc(questions.order), asc(questions.id));
    const prepared = hydrateQuestionsForSpss(normalizeQuestions(rows));
    // 표 칸 이름 — 양식형 표는 행 이름이 비어 있어 내보내기 라벨(「 - 년도1」)로는 칸을 알아볼 수
    // 없다. 같은 행 앞 글자 칸(「(1) 기업명」)으로 부른다.
    const cellLabels = new Map<string, string>();
    for (const q of prepared) {
      if (q.type !== 'table') continue;
      for (const [cellId, label] of tableInputCellLabels(q.tableRowsData ?? [])) {
        cellLabels.set(cellId, label);
      }
    }
    const sources: ProfileAnswerSource[] = [];
    for (const col of generateSPSSColumns(prepared)) {
      if (col.type === 'text') {
        sources.push({
          key: answerColumnKey(col.questionId),
          varName: col.spssVarName,
          questionTitle: col.questionText,
          cellLabel: null,
        });
      } else if (col.type === 'table-cell' && col.tableCellType === 'input' && col.tableCellId) {
        sources.push({
          key: answerColumnKey(col.questionId, col.tableCellId),
          varName: col.spssVarName,
          questionTitle: col.questionText,
          cellLabel: cellLabels.get(col.tableCellId) ?? (col.optionLabel || null),
        });
      }
    }
    return sources;
  },
);
