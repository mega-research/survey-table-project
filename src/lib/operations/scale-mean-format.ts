import {
  type SPSSExportColumn,
  type SpssColumnOptions,
  buildDataRow,
  generateSPSSColumns,
} from '@/lib/analytics/spss-excel-export';
import type { QuestionVariant } from '@/lib/question';
import type { Question, SurveySubmission, TableCell } from '@/types/survey';
import { resolveChoiceOptions } from '@/utils/choice-source';

/**
 * 척도 평균 (CONTEXT.md 「척도 평균」) — 순수 계산. SQL 부는 server/operations/services/scale-mean.ts.
 *
 * 점수를 따로 매기지 않는다. 열은 내보내기와 같은 `generateSPSSColumns`, 값은 같은 `buildDataRow` 를
 * 타므로 화면 평균이 .sav 로 낸 평균과 같다. 여기서 하는 일은 「평균 산출」을 켠 문항의 단일값 열을
 * 고르고, 「평균에서 제외」 보기의 값 코드를 빼고 세는 것뿐이다.
 */

export interface ScaleMeanRow {
  /** 내보내기 변수명 — 단일 선택은 문항코드, 행렬 척도는 `문항코드_행코드` */
  varName: string;
  questionId: string;
  /** 단일 선택은 문항 제목, 행렬 척도는 행 라벨 */
  label: string;
  /** 응답수가 0 이면 null */
  mean: number | null;
  /** 100점 환산 평균 — 척도 최저가 0, 최고가 100. 응답이 없거나 척도 범위가 한 점이면 null */
  mean100: number | null;
  /** 점수가 있는 응답 수 — 평균의 분모 */
  count: number;
  /** 「평균에서 제외」를 뺀 값 코드의 최소·최대. 값 코드가 없으면 null */
  scaleMin: number | null;
  scaleMax: number | null;
}

export type ScaleMeanOverall =
  | { kind: 'mean'; mean: number | null; mean100: number | null; count: number }
  /**
   * 척도 범위가 다른 줄이 섞여 원점수 종합 평균은 내지 않는다. 100점 환산은 줄마다 범위를 맞춘
   * 값이라 섞여도 낸다.
   */
  | { kind: 'mixed-scale'; mean100: number | null; count: number }
  /** 평균 산출을 켠 문항이 없다 */
  | { kind: 'empty' };

export interface ScaleMeanSummary {
  rows: ScaleMeanRow[];
  overall: ScaleMeanOverall;
}

type ScaleMeanSubmission = Pick<SurveySubmission, 'questionResponses'>;

interface ScaleColumn {
  column: SPSSExportColumn;
  label: string;
  scaleCodes: number[];
  excludedCodes: ReadonlySet<number>;
}

const SCALE_QUESTION_TYPES = new Set<Question['type']>(['radio', 'select', 'table']);

function flattenTitle(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim();
}

function cellsById(question: Question): Map<string, TableCell> {
  const map = new Map<string, TableCell>();
  for (const row of question.tableRowsData ?? []) {
    for (const cell of row.cells) map.set(cell.id, cell);
  }
  return map;
}

/** 값 코드 목록 — [코드, 평균에서 제외 여부]. 척도 줄이 될 수 없는 열이면 null. */
function codedValuesOf(
  column: SPSSExportColumn,
  question: Question,
): Array<[number, boolean]> | null {
  switch (column.type) {
    case 'single':
      return resolveChoiceOptions(question).map((option, idx) => [
        option.spssNumericCode ?? idx + 1,
        option.excludeFromMean === true,
      ]);
    case 'choice-group':
    case 'radio-group': {
      const valueMap =
        column.type === 'choice-group'
          ? column.choiceGroupCellValueMap
          : column.radioGroupCellValueMap;
      if (!valueMap) return null;
      const cells = cellsById(question);
      return Object.entries(valueMap).map(([cellId, code]) => [
        code,
        cells.get(cellId)?.excludeFromMean === true,
      ]);
    }
    case 'table-cell':
      if (column.tableCellType !== 'radio' || !column.cellOptions) return null;
      return column.cellOptions.map((option, idx) => [
        option.spssNumericCode ?? idx + 1,
        option.excludeFromMean === true,
      ]);
    default:
      return null;
  }
}

function labelOf(column: SPSSExportColumn, question: Question): string {
  switch (column.type) {
    case 'single':
      return flattenTitle(question.title);
    case 'choice-group':
      // 기본 그룹은 문항 자체가 변수다
      return column.spssVarName === question.questionCode
        ? flattenTitle(question.title)
        : flattenTitle(column.optionLabel);
    case 'table-cell':
      return flattenTitle(column.cellExportLabel ?? column.optionLabel);
    default:
      return flattenTitle(column.optionLabel);
  }
}

function selectScaleColumns(
  questions: readonly Question[],
  columns: readonly SPSSExportColumn[],
): ScaleColumn[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const result: ScaleColumn[] = [];
  for (const column of columns) {
    const question = byId.get(column.questionId);
    if (!question?.scaleMeanEnabled || !SCALE_QUESTION_TYPES.has(question.type)) continue;
    const coded = codedValuesOf(column, question);
    if (!coded || coded.length === 0) continue;
    result.push({
      column,
      label: labelOf(column, question),
      scaleCodes: coded.filter(([, excluded]) => !excluded).map(([code]) => code),
      excludedCodes: new Set(coded.filter(([, excluded]) => excluded).map(([code]) => code)),
    });
  }
  return result;
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * 100점 환산 — 척도 최저 0, 최고 100 으로 선형 변환(7점이면 1→0, 4→50, 7→100). 선형이라 평균을
 * 환산한 값과 점수마다 환산해 평균한 값이 같다. 범위가 한 점이면 환산할 수 없다.
 */
function toHundred(value: number | null, min: number | null, max: number | null): number | null {
  if (value === null || min === null || max === null || max <= min) return null;
  return ((value - min) / (max - min)) * 100;
}

function rangeOf(codes: readonly number[]): { min: number | null; max: number | null } {
  return codes.length > 0
    ? { min: Math.min(...codes), max: Math.max(...codes) }
    : { min: null, max: null };
}

/**
 * 완료 응답(호출측이 모수를 정한다)에서 척도 줄별 평균·응답수와 종합 평균을 낸다.
 * `questions` 는 내보내기와 같이 hydrate 된 지금 빌더 구조여야 한다.
 */
export function summarizeScaleMeans(
  questions: readonly Question[],
  submissions: readonly ScaleMeanSubmission[],
  options?: SpssColumnOptions,
): ScaleMeanSummary {
  const variants = questions as unknown as QuestionVariant[];
  const scaleColumns = selectScaleColumns(questions, generateSPSSColumns(variants, options));
  if (scaleColumns.length === 0) return { rows: [], overall: { kind: 'empty' } };

  const questionMap = new Map(variants.map((q) => [q.id, q]));
  const columnList = scaleColumns.map((c) => c.column);
  const ranges = scaleColumns.map((scale) => rangeOf(scale.scaleCodes));
  const scoresByRow: number[][] = scaleColumns.map(() => []);
  const respondentMeans: number[] = [];
  const respondentMeans100: number[] = [];

  for (const submission of submissions) {
    const values = buildDataRow(columnList, questionMap, submission as SurveySubmission);
    const own: number[] = [];
    const own100: number[] = [];
    values.forEach((value, idx) => {
      const scale = scaleColumns[idx];
      if (!scale || typeof value !== 'number' || !Number.isFinite(value)) return;
      if (scale.excludedCodes.has(value)) return;
      scoresByRow[idx]?.push(value);
      own.push(value);
      const score100 = toHundred(value, ranges[idx]?.min ?? null, ranges[idx]?.max ?? null);
      if (score100 !== null) own100.push(score100);
    });
    const ownMean = average(own);
    if (ownMean !== null) respondentMeans.push(ownMean);
    const ownMean100 = average(own100);
    if (ownMean100 !== null) respondentMeans100.push(ownMean100);
  }

  const rows: ScaleMeanRow[] = scaleColumns.map((scale, idx) => {
    const scores = scoresByRow[idx] ?? [];
    const { min, max } = ranges[idx] ?? { min: null, max: null };
    const mean = average(scores);
    return {
      varName: scale.column.spssVarName,
      questionId: scale.column.questionId,
      label: scale.label,
      mean,
      mean100: toHundred(mean, min, max),
      count: scores.length,
      scaleMin: min,
      scaleMax: max,
    };
  });

  const distinctRanges = new Set(rows.map((r) => `${r.scaleMin}~${r.scaleMax}`));
  const mean100 = average(respondentMeans100);
  const overall: ScaleMeanOverall =
    distinctRanges.size > 1
      ? { kind: 'mixed-scale', mean100, count: respondentMeans100.length }
      : {
          kind: 'mean',
          mean: average(respondentMeans),
          mean100,
          count: respondentMeans.length,
        };

  return { rows, overall };
}

export interface ScaleMeanCandidate {
  questionId: string;
  /** 문항코드 — 없으면 첫 척도 줄 변수명 */
  code: string;
  title: string;
  /** 켜면 생기는 척도 줄 수 — 행렬 척도는 행 수 */
  rowCount: number;
  enabled: boolean;
}

/**
 * 콘솔 「문항 선택」 목록 — 켜면 척도 줄이 하나 이상 생기는 문항. 켜짐 여부와 무관하게 같은 판정
 * (`selectScaleColumns`)을 타므로 후보에 있는 문항은 켜면 반드시 표에 줄이 생긴다.
 */
export function listScaleMeanCandidates(
  questions: readonly Question[],
  options?: SpssColumnOptions,
): ScaleMeanCandidate[] {
  const asEnabled = questions.map((q) =>
    SCALE_QUESTION_TYPES.has(q.type) ? { ...q, scaleMeanEnabled: true } : q,
  );
  const columns = generateSPSSColumns(asEnabled as unknown as QuestionVariant[], options);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const candidates = new Map<string, ScaleMeanCandidate>();
  for (const { column } of selectScaleColumns(asEnabled, columns)) {
    const existing = candidates.get(column.questionId);
    if (existing) {
      existing.rowCount += 1;
      continue;
    }
    const question = byId.get(column.questionId);
    if (!question) continue;
    candidates.set(column.questionId, {
      questionId: question.id,
      code: question.questionCode || column.spssVarName,
      title: flattenTitle(question.title),
      rowCount: 1,
      enabled: question.scaleMeanEnabled === true,
    });
  }
  return [...candidates.values()];
}

export type ScaleMeanSelection = { ok: true; questionIds: string[] } | { ok: false; error: string };

/**
 * 「문항 선택」 저장 입력 검증. 고른 집합이 곧 켜진 문항 전체다(나머지는 끈다).
 * 후보 밖 id 가 섞이면 일부만 반영하지 않고 통째로 거부한다 — 화면이 낡았다는 신호다.
 */
export function resolveScaleMeanSelection(
  candidates: readonly ScaleMeanCandidate[],
  questionIds: readonly string[],
): ScaleMeanSelection {
  const allowed = new Set(candidates.map((c) => c.questionId));
  if (questionIds.some((id) => !allowed.has(id))) {
    return {
      ok: false,
      error: '평균을 낼 수 없는 문항이 섞여 있습니다. 화면을 새로고침한 뒤 다시 골라 주세요.',
    };
  }
  return { ok: true, questionIds: [...new Set(questionIds)] };
}

/** 평균 표시 — 소수 둘째 자리. 응답이 없으면 대시. */
export function formatScaleMean(mean: number | null): string {
  return mean === null ? '—' : mean.toFixed(2);
}

/**
 * 100점 환산 표시 — 소수 첫째 자리 반올림. 응답이 없으면 대시.
 * 10 을 곱한 값을 유효숫자 12자리로 잘라 이진 표현 오차(83.35 × 10 이 833.4999… 가 되는 등)로
 * 내림되지 않게 한다. toFixed 만 쓰면 그 오차대로 83.3 이 된다.
 */
export function formatScaleMean100(mean100: number | null): string {
  if (mean100 === null) return '—';
  return (Math.round(Number((mean100 * 10).toPrecision(12))) / 10).toFixed(1);
}

/** 「전체」 줄의 문항 칸 — 어느 줄들을 묶었는지 첫·끝 변수명으로 적는다. */
export function overallRowLabel(rows: readonly ScaleMeanRow[]): string {
  const first = rows[0]?.varName;
  const last = rows[rows.length - 1]?.varName;
  if (!first || !last) return '응답자별 평균';
  return first === last ? `응답자별 평균 (${first})` : `응답자별 평균 (${first}~${last})`;
}
