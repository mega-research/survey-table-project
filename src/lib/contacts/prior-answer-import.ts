/**
 * 이월 응답 임포트 — 해석·제안·값 변환 (순수).
 *
 * 파일 입출력도 데이터베이스도 모른다. 시트 내용(헤더 + 행)과 문항 목록만으로
 * 매핑 제안과 조사 대상별 값 묶음을 낸다. 임포트 사고는 대부분 이 자리에서 나므로
 * 화면·서비스와 떼어 놓고 실제 rawdata 모양으로 고정한다.
 *
 * 헤더 해석과 블록↔문항 자리 배정은 `prior-answer-blocks` 가 맡고, 이 모듈은 그 배정을
 * 받아 조사 대상별 값 묶음을 만든다.
 */

import type { Question } from '@/types/survey';
import { buildBlockAnswer, type BlockSlot, type HeaderBlock } from './prior-answer-blocks';

export { normalizeQuestionCode } from './prior-answer-blocks';

/**
 * 조사 대상 번호 대조 키. resid 는 정수 컬럼이라 `07` 과 `7` 이 같은 대상이다 —
 * 따로 두면 적재가 같은 대상을 한 배치에 두 번 실어 통째로 실패한다.
 * 정수로 읽히지 않으면 원래 문자열을 그대로 쓴다(미매칭으로 남아 화면에 보인다).
 */
export function normalizeResid(raw: string): string {
  const trimmed = raw.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return trimmed;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? String(parsed) : trimmed;
}

/** 문항별 선택지 변환 실패 집계 — 어느 값이 어느 선택지에도 안 맞았는지 그대로 남긴다. */
export interface OptionMismatch {
  questionId: string;
  /** 이 문항에 값이 들어 있던 행 수 */
  total: number;
  /** 그중 어느 선택지에도 맞지 않은 행 수 */
  unmatched: number;
  /** unmatched / total. 건수가 아니라 비율이어야 절반만 실패한 문항이 눈에 띈다. */
  rate: number;
  /** 맞지 않은 원본 값과 그 건수 (건수 내림차순) */
  values: Array<{ value: string; count: number }>;
}

export interface BlockAssignment {
  block: HeaderBlock;
  questionId: string;
  slots: BlockSlot[];
}

export interface PriorAnswerImportInput {
  /** 문항 id → { 원본 값 → 선택지 저장값 }. 확정된 값 대응. */
  valueAliases?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** 데이터 행. 컬럼 인덱스 순서 그대로. */
  rows: ReadonlyArray<readonly string[]>;
  /** 조사 대상을 찾을 컬럼 인덱스 — 설문별 자동 발번 번호(시스템ID)가 들어 있다. */
  residColumnIndex: number;
  /** 사람이 확정한 블록↔문항 배정 */
  assignments: readonly BlockAssignment[];
  questions: readonly Question[];
}

export interface PriorAnswerImportResult {
  /** 조사 대상 번호별 값 묶음. 값이 하나도 없는 대상은 담지 않는다. */
  records: Array<{ resid: string; answers: Record<string, unknown> }>;
  optionMismatches: OptionMismatch[];
  /** 조사 대상 번호가 비어 버린 행 수 */
  emptyResidRows: number;
  /** 같은 번호가 다시 나와 앞 행을 덮은 횟수 */
  duplicateResidRows: number;
  /** 이 경로가 값을 만들 수 없어 건너뛴 문항 id */
  unsupportedQuestionIds: string[];
}

/**
 * 시트 행을 조사 대상별 값 묶음으로 바꾼다.
 *
 * 값은 응답 저장 형태와 동형으로 나온다 — 선택지 문항은 라벨 텍스트를 저장값으로
 * 변환하고, 어느 선택지에도 맞지 않으면 **그 문항만 비우고** 집계에 남긴다.
 * 빈 셀은 값을 만들지 않는다: 빈칸으로 덮어쓰면 지난 회차에 답이 있었는지 없었는지
 * 구분이 사라진다.
 */
export function buildPriorAnswerRecords(
  input: PriorAnswerImportInput,
): PriorAnswerImportResult {
  const questionById = new Map(input.questions.map((q) => [q.id, q]));
  const unsupported = new Set<string>();

  const targets: Array<{ question: Question; assignment: BlockAssignment }> = [];
  for (const assignment of input.assignments) {
    const question = questionById.get(assignment.questionId);
    if (!question) continue;
    // 값을 만들 자리가 하나도 없는 배정 — 화면에서 알린다.
    if (assignment.slots.every((slot) => slot.kind === 'unmatched')) {
      unsupported.add(assignment.questionId);
      continue;
    }
    targets.push({ question, assignment });
  }

  const byResid = new Map<string, Record<string, unknown>>();
  const seenResid = new Set<string>();
  const mismatchByQuestion = new Map<
    string,
    { total: number; unmatched: number; counts: Map<string, number> }
  >();
  let emptyResidRows = 0;
  let duplicateResidRows = 0;

  for (const row of input.rows) {
    const resid = normalizeResid(row[input.residColumnIndex] ?? '');
    if (!resid) {
      emptyResidRows += 1;
      continue;
    }
    if (seenResid.has(resid)) duplicateResidRows += 1;
    seenResid.add(resid);

    const answers: Record<string, unknown> = {};
    for (const { question, assignment } of targets) {
      const cellValues = assignment.block.columnIndexes.map((col) => row[col] ?? '');
      const built = buildBlockAnswer(
        question,
        assignment.slots,
        cellValues,
        input.valueAliases?.[question.id],
      );

      if (built.convertedCells > 0 || built.unmatchedValues.length > 0) {
        const stat = mismatchByQuestion.get(question.id) ?? {
          total: 0,
          unmatched: 0,
          counts: new Map<string, number>(),
        };
        stat.total += built.convertedCells;
        stat.unmatched += built.unmatchedValues.length;
        for (const value of built.unmatchedValues) {
          stat.counts.set(value, (stat.counts.get(value) ?? 0) + 1);
        }
        mismatchByQuestion.set(question.id, stat);
      }

      if (built.value !== undefined) answers[question.id] = built.value;
    }

    // 이 행에 살아남은 값이 없으면 아무것도 하지 않는다 — 같은 번호의 앞 행이 이미
    // 들고 있는 값을 빈 묶음으로 덮거나 지우지 않는다.
    if (Object.keys(answers).length === 0) continue;
    byResid.set(resid, answers);
  }

  const optionMismatches: OptionMismatch[] = [];
  for (const [questionId, stat] of mismatchByQuestion) {
    if (stat.unmatched === 0) continue;
    optionMismatches.push({
      questionId,
      total: stat.total,
      unmatched: stat.unmatched,
      rate: stat.total > 0 ? stat.unmatched / stat.total : 0,
      values: [...stat.counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    });
  }
  // 실패율이 높은 문항이 위로 온다 — 경고 수십 줄에 묻히면 "절반만 실패" 를 놓친다.
  optionMismatches.sort((a, b) => b.rate - a.rate || b.unmatched - a.unmatched);

  return {
    records: [...byResid.entries()].map(([resid, answers]) => ({ resid, answers })),
    optionMismatches,
    emptyResidRows,
    duplicateResidRows,
    unsupportedQuestionIds: [...unsupported],
  };
}
