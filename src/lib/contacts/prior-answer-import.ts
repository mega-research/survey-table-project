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

import { type BlockSlot, type HeaderBlock, buildBlockAnswer } from './prior-answer-blocks';

export { normalizeQuestionCode } from './prior-answer-blocks';

/**
 * 대조값 정규화 — 앞뒤 공백만 턴다.
 *
 * 정수로 접지 않는 이유: 대조 상대가 조사 대상 명단의 attrs 값(UID·이름 등)이고
 * 그쪽은 문자열이다. `007` 을 `7` 로 접으면 앞 0 이 의미 있는 식별자에서 남의 대상에
 * 조용히 붙는다. 어긋난 값은 접어서 억지로 맞추지 않고 미매칭으로 남겨 화면에 보인다.
 * 양쪽 값이 모두 같은 엑셀 업로드 경로를 지나왔다면 형태가 이미 같다.
 */
export function normalizeMatchValue(raw: string): string {
  return raw.trim();
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
  /** 조사 대상을 찾을 컬럼 인덱스 — 명단의 attrs 열과 맞출 값이 들어 있다. */
  matchColumnIndex: number;
  /** 사람이 확정한 블록↔문항 배정 */
  assignments: readonly BlockAssignment[];
  questions: readonly Question[];
}

export interface PriorAnswerImportResult {
  /** 대조값별 값 묶음. 값이 하나도 없는 대상과 파일 안에서 중복된 대조값은 담지 않는다. */
  records: Array<{ matchValue: string; answers: Record<string, unknown> }>;
  optionMismatches: OptionMismatch[];
  /** 대조값이 비어 버린 행 수 */
  emptyMatchRows: number;
  /**
   * 파일 안에서 두 번 이상 나온 대조값 — 어느 행이 맞는지 알 수 없어 **전부 뺐다**.
   * 뒤 행이 앞 행을 덮던 예전 방식은 임의 선택이었다. 잘못 붙은 이월 응답은 응답
   * 화면에서 남의 지난 답으로 보이므로 모호하면 붙이지 않는다.
   */
  duplicateMatchValues: string[];
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
export function buildPriorAnswerRecords(input: PriorAnswerImportInput): PriorAnswerImportResult {
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

  const byMatchValue = new Map<string, Record<string, unknown>>();
  // 값이 살아남았는지와 무관하게 "파일에 이 대조값이 나왔다"를 센다 — 값이 빈 중복 행도
  // 모호함을 만든다.
  const seenMatchValues = new Set<string>();
  const duplicateMatchValues = new Set<string>();
  const mismatchByQuestion = new Map<
    string,
    { total: number; unmatched: number; counts: Map<string, number> }
  >();
  let emptyMatchRows = 0;

  for (const row of input.rows) {
    const matchValue = normalizeMatchValue(row[input.matchColumnIndex] ?? '');
    if (!matchValue) {
      emptyMatchRows += 1;
      continue;
    }
    if (seenMatchValues.has(matchValue)) duplicateMatchValues.add(matchValue);
    seenMatchValues.add(matchValue);

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

    // 이 행에 살아남은 값이 없으면 아무것도 하지 않는다.
    if (Object.keys(answers).length === 0) continue;
    byMatchValue.set(matchValue, answers);
  }

  // 중복 대조값은 통째로 뺀다 — 남은 한 행을 고르는 규칙이 없다.
  for (const value of duplicateMatchValues) byMatchValue.delete(value);

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
    records: [...byMatchValue.entries()].map(([matchValue, answers]) => ({ matchValue, answers })),
    optionMismatches,
    emptyMatchRows,
    duplicateMatchValues: [...duplicateMatchValues],
    unsupportedQuestionIds: [...unsupported],
  };
}
