/**
 * 설문 구조의 SPSS 변수명 — 내보내기 라우트(`src/app/api/surveys/[surveyId]/export/route.ts`)와 같은 함수 사슬.
 *
 *   normalizeQuestions → hydrateQuestionsForSpss → applyExportRowExclusions → 언어 묶음 → generateSPSSColumns
 *
 * 응답에 따라 빠지는 열(안 쓴 벌·안 쓴 열)과 이월 응답에 따라 붙는 변동 확인 열은 넣지 않는다 —
 * 이 목록은 「구조가 만드는 변수 전체」이고, 패치 전후를 비교해 이름이 없어지는지 보는 데 쓴다.
 * 라우트가 사슬을 바꾸면 `tests/repo/survey-ops.test.ts` 의 소스 단언이 먼저 깨진다 — 그때 여기도 맞출 것.
 *
 * `@/server/read-models/survey-structure` 가 import 시점에 DB 접속을 만들므로 이 파일은
 * `loadOpsEnv` 뒤에 동적 import 한다.
 */
import { asc, eq } from 'drizzle-orm';

import type { DbOrTx } from '@/db';
import { questionGroups, questions, surveys } from '@/db/schema';
import { applyExportRowExclusions } from '@/lib/analytics/export-exclusions';
import { generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
import { normalizeQuestions } from '@/lib/question';
import { hydrateQuestionsForSpss } from '@/lib/spss/hydrate-questions';
import { mapGroupRow } from '@/server/read-models/survey-structure';
import { resolveLanguageSetLocales } from '@/utils/survey-language';

export interface StructureVariable {
  name: string;
  questionId: string;
  /** 사람이 알아볼 라벨 — 문항 글자 / 보기·칸 라벨 */
  label: string;
}

export interface SurveyStructureRows {
  questionRows: (typeof questions.$inferSelect)[];
  groupRows: (typeof questionGroups.$inferSelect)[];
}

/** 내보내기와 같은 읽기 — 문항은 order 오름차순(라우트 주석: 순서가 없으면 변수 순서가 흔들린다). */
export async function loadStructureRows(
  executor: DbOrTx,
  surveyId: string,
): Promise<SurveyStructureRows> {
  const [questionRows, groupRows] = await Promise.all([
    executor
      .select()
      .from(questions)
      .where(eq(questions.surveyId, surveyId))
      .orderBy(asc(questions.order)),
    executor
      .select()
      .from(questionGroups)
      .where(eq(questionGroups.surveyId, surveyId))
      .orderBy(asc(questionGroups.order)),
  ]);
  return { questionRows, groupRows };
}

export function structureVariables(
  surveyId: string,
  rows: SurveyStructureRows,
): StructureVariable[] {
  const prepared = applyExportRowExclusions(
    surveyId,
    hydrateQuestionsForSpss(normalizeQuestions(rows.questionRows)),
  );
  const languageSetLocales = resolveLanguageSetLocales(prepared, rows.groupRows.map(mapGroupRow));
  const columns = generateSPSSColumns(
    prepared,
    languageSetLocales.size > 0 ? { languageSetLocales } : undefined,
  );
  return columns.map((c) => ({
    name: c.spssVarName,
    questionId: c.questionId,
    label: [stripHtml(c.questionText), c.optionLabel].filter((s) => s && s.trim()).join(' / '),
  }));
}

export interface VariableDiff {
  removed: StructureVariable[];
  added: StructureVariable[];
}

/** 이름 기준 차이 — 순서만 바뀐 것은 차이가 아니다. */
export function diffVariables(
  before: readonly StructureVariable[],
  after: readonly StructureVariable[],
): VariableDiff {
  const afterNames = new Set(after.map((v) => v.name));
  const beforeNames = new Set(before.map((v) => v.name));
  return {
    removed: before.filter((v) => !afterNames.has(v.name)),
    added: after.filter((v) => !beforeNames.has(v.name)),
  };
}

export function formatVariableDiff(diff: VariableDiff, limit = 40): string {
  const lines: string[] = [];
  const list = (title: string, vars: StructureVariable[]) => {
    if (vars.length === 0) return;
    lines.push(`${title} ${vars.length}개`);
    for (const v of vars.slice(0, limit)) lines.push(`  ${v.name}  ${truncate(v.label, 60)}`);
    if (vars.length > limit) lines.push(`  … 외 ${vars.length - limit}개`);
  };
  list('없어지는 변수명', diff.removed);
  list('새로 생기는 변수명', diff.added);
  return lines.length > 0 ? lines.join('\n') : '변수명 변화 없음';
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** CLI 가 설문 행이 있는지 볼 때 쓴다. */
export async function surveyTitle(executor: DbOrTx, surveyId: string): Promise<string | null> {
  const [row] = await executor
    .select({ title: surveys.title })
    .from(surveys)
    .where(eq(surveys.id, surveyId));
  return row?.title ?? null;
}
