/**
 * 이월 응답 임포트 — 3단 병합 헤더와 컬럼 블록 (순수).
 *
 * 실무 rawdata 헤더는 세 줄이다: 파트 행 / 문항코드 행 / 세부 라벨 행.
 * 문항코드 행은 가로 병합돼 있어 **값이 있는 칸부터 다음 값이 나오기 전까지**가 한 문항의
 * 컬럼 블록이다. 그 블록 단위로 이어야 아홉 칸짜리 표 문항, 열 칸으로 펼쳐진 복수응답,
 * 1순위·2순위로 나뉜 순위 문항이 통째로 붙는다.
 *
 * 파일 입출력도 데이터베이스도 모른다 — 헤더/데이터 격자와 문항 목록만 받는다.
 */

import type { Question, QuestionOption, TableCell } from '@/types/survey';
import { isGroupedChoiceQuestion } from '@/utils/choice-group-helpers';
import { resolveChoiceOptions } from '@/utils/choice-source';
import { resolveRankingOptions } from '@/utils/ranking-source';

/**
 * 문항코드 대조용 정규화.
 *
 * 설문지에는 `BQ1-1.` 로 적히고 문항코드에는 `BQ1_1` 로 들어간다 — SPSS 변수명 규격이
 * 대시와 마침표를 거부하기 때문이다. 그 차이를 대조 시점에 흡수한다:
 * 후행 마침표 제거, 대시를 밑줄로, 공백 제거, 대소문자 무시.
 */
export function normalizeQuestionCode(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .trim()
    .replace(/\.+$/, '')
    .replace(/-/g, '_')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** 3단 헤더에서 잘라낸 한 문항의 컬럼 블록. */
export interface HeaderBlock {
  /** 문항코드 행 원문(블록 첫 칸). 실무 파일은 `BQ1-1. 창업 기업명` 처럼 코드와 라벨이 붙어 있다. */
  codeText: string;
  /** codeText 의 선두 토큰 — 문항코드 후보. */
  code: string;
  /**
   * 문항 내용 대조용 텍스트. codeText 에서 코드를 뺀 나머지이며, 비어 있고 블록이 한 칸이면
   * 세부 라벨을 쓴다. 코드가 밀린 파일을 잡아내는 근거라 코드와 별개로 들고 있는다.
   */
  label: string;
  /** 이 블록이 차지하는 컬럼 인덱스(0-based, 오름차순). */
  columnIndexes: number[];
  /** 파트 행 텍스트 — 블록 첫 칸 기준. 없으면 빈 문자열. */
  part: string;
  /** 세부 라벨 행 텍스트. columnIndexes 와 같은 순서·길이. */
  detailLabels: string[];
}

/** 블록의 한 컬럼이 문항의 어느 자리에 들어가는가. */
export type BlockSlot =
  /** 문항 값 전체가 이 한 칸이다. */
  | { kind: 'single' }
  /** 표 문항의 한 칸. 저장 형태가 셀 타입마다 다르므로 타입을 함께 싣는다. */
  | { kind: 'table-cell'; cellId: string; cellType: TableCell['type'] }
  /** 복수응답 펼침의 한 보기. */
  | { kind: 'checkbox-option'; optionValue: string }
  /** 순위 문항의 한 순위(1-based). */
  | { kind: 'ranking-rank'; rank: number }
  /** 어느 자리인지 정하지 못했다 — 값을 만들지 않는다. */
  | { kind: 'unmatched' };

/**
 * 블록↔문항 판정.
 *
 * - `auto` — 코드가 맞고 문항 내용도 유사하다. 그대로 제안한다.
 * - `code-conflict` — 코드는 맞는데 **문항 내용이 다르다**. 매핑하지 않고 경고한다.
 *   지난 회차에 파트가 재편되며 코드가 한 칸씩 밀린 실제 사례가 있어, 코드만 믿으면
 *   지난 회차 만족도 값이 올해 창업의향 문항에 조용히 꽂힌다.
 * - `label-candidate` — 코드는 다른데 문항 내용이 같다. 후보로 제안하되 확인을 요구한다.
 * - `unmapped` — 그 외.
 */
export type BlockVerdict = 'auto' | 'code-conflict' | 'label-candidate' | 'unmapped';

export interface BlockSuggestion {
  block: HeaderBlock;
  questionId: string | null;
  matchedBy: 'code' | 'label' | null;
  verdict: BlockVerdict;
  /** code-conflict 일 때 코드가 가리킨 문항 — 담당자가 무엇과 충돌했는지 알아야 한다. */
  conflictQuestionId?: string;
  /** block.columnIndexes 와 같은 순서·길이. */
  slots: BlockSlot[];
}

/**
 * 문항 내용 유사도(0~1). 정규화 후 같으면 1, 아니면 바이그램 Dice 계수.
 *
 * 완전 일치만 보면 조사표를 옮겨 적으며 생긴 사소한 차이("~입니까" ↔ "~습니까")에
 * 전부 경고가 뜨고, 아예 안 보면 코드가 밀린 사고를 못 잡는다.
 */
export function labelSimilarity(a: string, b: string): number {
  const left = labelKey(a);
  const right = labelKey(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const bigrams = (text: string) => {
    const grams = new Map<string, number>();
    for (let i = 0; i < text.length - 1; i++) {
      const gram = text.slice(i, i + 2);
      grams.set(gram, (grams.get(gram) ?? 0) + 1);
    }
    return grams;
  };
  const leftGrams = bigrams(left);
  const rightGrams = bigrams(right);
  let shared = 0;
  for (const [gram, count] of leftGrams) {
    shared += Math.min(count, rightGrams.get(gram) ?? 0);
  }
  const total = left.length - 1 + (right.length - 1);
  return total > 0 ? (2 * shared) / total : 0;
}

/** 이 값 이상이면 "문항 내용이 유사하다"고 본다. */
export const LABEL_SIMILAR_THRESHOLD = 0.6;

/** 한 칸의 텍스트로 값이 정해지는 문항 유형. 그 외는 이 경로가 값을 만들지 않는다. */
const SINGLE_CELL_TYPES = new Set<Question['type']>(['text', 'textarea', 'radio', 'select']);

/** 문항코드 대조 후보 — 헤더 전체와 선두 토큰. */
function headerCodeCandidates(header: string): string[] {
  const whole = normalizeQuestionCode(header);
  const leading = normalizeQuestionCode(header.trim().split(/\s+/)[0] ?? '');
  const candidates = leading && leading !== whole ? [whole, leading] : [whole];
  return candidates.filter(Boolean);
}

/** 라벨 대조 키 — 앞뒤 공백·중간 공백·대소문자를 무시한다. */
function labelKey(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, '').toLowerCase();
}

/**
 * 3단 헤더를 컬럼 블록으로 자른다.
 *
 * 코드 행의 빈 칸은 앞 칸의 코드를 이어받는다(가로 병합). 병합 없이 코드가 칸마다
 * 반복된 파일도 같은 결과가 나오도록 **같은 코드가 이어지는 구간**을 한 블록으로 본다.
 * 코드가 나오기 전의 앞 칸들은 어느 문항에도 속하지 않아 블록이 되지 않는다.
 *
 * `codeRowMerged` 를 주면 빈 칸 중 **실제 가로 병합 종속 칸만** 앞 블록을 잇는다.
 * 주지 않으면(손으로 만든 격자) 빈 칸을 모두 병합으로 본다.
 *
 * @param headerRows 헤더 행들. 길이 3이면 [파트, 코드, 세부라벨], 2면 [코드, 세부라벨],
 *   1이면 [코드] 로 읽는다.
 * @param codeRowMerged 컬럼별 가로 병합 종속 여부 (excel-parser 가 낸다)
 */
export function splitHeaderBlocks(
  headerRows: readonly (readonly string[])[],
  codeRowMerged?: readonly boolean[],
): HeaderBlock[] {
  const rowCount = headerRows.length;
  const partRow = rowCount >= 3 ? headerRows[rowCount - 3] : undefined;
  const codeRow = rowCount >= 2 ? headerRows[rowCount - 2] : headerRows[0];
  const detailRow = rowCount >= 2 ? headerRows[rowCount - 1] : undefined;
  if (!codeRow) return [];

  const columnCount = Math.max(
    ...headerRows.map((row) => row.length),
    0,
  );

  const blocks: HeaderBlock[] = [];
  let carriedCode = '';
  for (let col = 0; col < columnCount; col++) {
    const raw = (codeRow[col] ?? '').trim();
    if (raw) carriedCode = raw;
    // 빈 칸이 앞 문항을 잇는가. 병합 정보가 있으면 그 판정을 따르고, 없으면 빈 칸을
    // 모두 병합으로 본다 — 병합 정보 없이는 메타 열과 뻗은 칸을 구분할 수 없다.
    const continuesPrevious = raw === '' && (codeRowMerged ? codeRowMerged[col] === true : true);
    const code = raw || (continuesPrevious ? carriedCode : '');
    // 코드가 없는 칸 — 어느 문항에도 속하지 않는다(문항 사이의 메타 열 포함).
    if (!code) continue;

    const last = blocks[blocks.length - 1];
    if (last !== undefined && last.codeText === code) {
      last.columnIndexes.push(col);
      last.detailLabels.push((detailRow?.[col] ?? '').trim());
      continue;
    }
    const [leading, ...rest] = code.split(/\s+/);
    blocks.push({
      codeText: code,
      code: leading ?? code,
      label: rest.join(' ').trim(),
      columnIndexes: [col],
      part: (partRow?.[col] ?? '').trim(),
      detailLabels: [(detailRow?.[col] ?? '').trim()],
    });
  }
  // 코드 칸에 라벨이 없을 때만 세부 라벨을 문항 내용으로 본다. 그것도 **한 칸짜리 블록**
  // 에서만이다 — 여러 칸 블록의 세부 라벨은 칸 이름이지 문항 내용이 아니라서, 그대로
  // 대조하면 표·복수응답·순위 블록마다 거짓 경고가 뜬다.
  for (const block of blocks) {
    if (!block.label && block.columnIndexes.length === 1) {
      block.label = block.detailLabels.filter(Boolean).join(' ');
    }
  }
  return blocks;
}

/**
 * 표 문항에서 값을 받을 수 있는 칸(읽는 순서).
 *
 * 표시 전용 셀과 **계산 셀(calc)** 은 제외한다 — 계산 셀은 수식 결과가 곧 값이라
 * 외부 값을 적재하면 "수식 결과와 다른 저장값" 이라는 없는 상태를 만든다.
 */
function collectAnswerableCells(
  question: Question,
): Array<{ cell: TableCell; rowLabel: string; colLabel: string }> {
  const result: Array<{ cell: TableCell; rowLabel: string; colLabel: string }> = [];
  for (const row of question.tableRowsData ?? []) {
    row.cells?.forEach((cell, colIdx) => {
      if (cell.isHidden) return;
      if (!['input', 'checkbox', 'radio', 'select'].includes(cell.type)) return;
      result.push({
        cell,
        rowLabel: row.label ?? '',
        colLabel: question.tableColumns?.[colIdx]?.label ?? '',
      });
    });
  }
  return result;
}

/** 표 셀의 선택지. 셀 타입별 필드가 달라 한 곳에서 모은다. */
function cellOptions(cell: TableCell): QuestionOption[] {
  if (cell.type === 'checkbox') return (cell.checkboxOptions ?? []) as QuestionOption[];
  if (cell.type === 'radio') return (cell.radioOptions ?? []) as QuestionOption[];
  if (cell.type === 'select') return cell.selectOptions ?? [];
  return [];
}

/** 표 셀의 저장 키 — 셀 컴포넌트들이 `option.value ?? option.id` 로 저장한다. */
function cellOptionKey(option: QuestionOption): string {
  return option.value ?? option.id;
}

/** 세부 라벨에서 순위 번호를 읽는다. "1순위", "순위1", "1st" 모두 1. */
function parseRankFromLabel(label: string): number | null {
  const match = label.match(/(\d+)\s*순위|순위\s*(\d+)|^(\d+)$/);
  if (!match) return null;
  const digits = match[1] ?? match[2] ?? match[3];
  const rank = Number(digits);
  return Number.isInteger(rank) && rank > 0 ? rank : null;
}

function findOptionByLabel(
  options: QuestionOption[],
  label: string,
  valueAliases?: Readonly<Record<string, string>>,
): QuestionOption | undefined {
  const key = labelKey(label);
  if (!key) return undefined;
  const exact = options.find((option) => labelKey(option.label) === key);
  if (exact) return exact;
  // 확정 대응은 라벨이 아니라 저장값을 가리킨다 — 그 저장값이 실재할 때만 쓴다.
  const aliased = valueAliases?.[label.trim()];
  if (!aliased) return undefined;
  return options.find((option) => (option.value ?? option.id) === aliased);
}

/**
 * 블록 컬럼들이 이 문항의 어느 자리인지 정한다.
 *
 * 자동 제안과 **사람이 화면에서 고른 문항** 이 같은 규칙을 쓰게 하려고 내보낸다 —
 * 제안 경로로만 자리를 정하면 코드가 다른 문항을 고른 순간 전 칸이 미배정이 된다.
 */
export function resolveSlots(question: Question, block: HeaderBlock): BlockSlot[] {
  const count = block.columnIndexes.length;

  if (question.type === 'table') {
    const cells = collectAnswerableCells(question);
    const byLabel = block.detailLabels.map((label) => {
      const key = labelKey(label);
      if (!key) return undefined;
      return cells.find(
        (entry) =>
          labelKey(entry.cell.exportLabel) === key ||
          labelKey(entry.rowLabel) === key ||
          labelKey(entry.colLabel) === key ||
          labelKey(`${entry.rowLabel}${entry.colLabel}`) === key,
      );
    });
    // 세부 라벨로 다 맞지 않으면 읽는 순서로 채운다 — 라벨이 비어 있는 파일이 흔하다.
    const allMatched = byLabel.every((entry) => entry !== undefined);
    if (!allMatched && cells.length === count) {
      return cells.map((entry) => ({
        kind: 'table-cell' as const,
        cellId: entry.cell.id,
        cellType: entry.cell.type,
      }));
    }
    return byLabel.map((entry) =>
      entry
        ? { kind: 'table-cell' as const, cellId: entry.cell.id, cellType: entry.cell.type }
        : { kind: 'unmatched' as const },
    );
  }

  if (question.type === 'checkbox') {
    const options = resolveChoiceOptions(question);
    return block.detailLabels.map((label) => {
      const option = findOptionByLabel(options, label);
      return option
        ? { kind: 'checkbox-option' as const, optionValue: option.value }
        : { kind: 'unmatched' as const };
    });
  }

  if (question.type === 'ranking') {
    return block.detailLabels.map((label, idx) => {
      const rank = parseRankFromLabel(label) ?? idx + 1;
      return { kind: 'ranking-rank' as const, rank };
    });
  }

  // 단일 컬럼 문항 — 블록이 한 칸이고 그 유형이 한 칸으로 정해질 때만 자리를 준다.
  const single = count === 1 && SINGLE_CELL_TYPES.has(question.type);
  return block.columnIndexes.map((_, idx) =>
    single && idx === 0 ? { kind: 'single' as const } : { kind: 'unmatched' as const },
  );
}

/**
 * 블록과 문항을 잇는 자동 제안.
 *
 * 문항코드 정규화 대조로 문항을 정하고, 블록 컬럼들이 그 문항의 어느 자리인지까지
 * 한 번에 정한다 — 표 아홉 칸을 사람이 아홉 번 확정하지 않게 하는 것이 이 티켓의 요지다.
 */
export function suggestBlockMapping(
  blocks: readonly HeaderBlock[],
  questions: readonly Question[],
): BlockSuggestion[] {
  const byCode = new Map<string, Question>();
  for (const question of questions) {
    // 보기 그룹이 있는 문항은 저장형이 { groupKey: 값 } 객체라 블록 단위로도 만들 수 없다.
    if (isGroupedChoiceQuestion(question)) continue;
    const code = normalizeQuestionCode(question.questionCode);
    if (!code || byCode.has(code)) continue;
    byCode.set(code, question);
  }

  const eligible = questions.filter((question) => !isGroupedChoiceQuestion(question));
  const taken = new Set<string>();
  const unmatchedSlots = (block: HeaderBlock): BlockSlot[] =>
    block.columnIndexes.map(() => ({ kind: 'unmatched' as const }));

  return blocks.map((block): BlockSuggestion => {
    // 실무 헤더는 `BQ1-1. 창업 기업명` 처럼 코드와 라벨이 한 칸에 붙어 있다 —
    // 전체와 선두 토큰을 둘 다 후보로 본다.
    const byCodeMatch = headerCodeCandidates(block.codeText)
      .map((code) => byCode.get(code))
      .find((found) => found !== undefined);

    if (byCodeMatch && !taken.has(byCodeMatch.id)) {
      // 대조할 문항 내용이 없으면 코드 일치만으로 간다 — 라벨 없는 파일에서 코드 일치를
      // 경고로 뒤집으면 매핑이 전부 막힌다.
      const similar =
        !block.label || labelSimilarity(block.label, byCodeMatch.title) >= LABEL_SIMILAR_THRESHOLD;
      if (similar) {
        taken.add(byCodeMatch.id);
        return {
          block,
          questionId: byCodeMatch.id,
          matchedBy: 'code',
          verdict: 'auto',
          slots: resolveSlots(byCodeMatch, block),
        };
      }
      return {
        block,
        questionId: null,
        matchedBy: null,
        verdict: 'code-conflict',
        conflictQuestionId: byCodeMatch.id,
        slots: unmatchedSlots(block),
      };
    }

    // 코드가 다르다 — 문항 내용이 같으면 후보로 올린다(파트 재편으로 코드가 밀린 경우).
    if (block.label) {
      const byLabel = eligible
        .filter((question) => !taken.has(question.id))
        .map((question) => ({
          question,
          score: labelSimilarity(block.label, question.title),
        }))
        .filter((entry) => entry.score >= LABEL_SIMILAR_THRESHOLD)
        .sort((a, b) => b.score - a.score)[0];
      if (byLabel) {
        taken.add(byLabel.question.id);
        return {
          block,
          questionId: byLabel.question.id,
          matchedBy: 'label',
          verdict: 'label-candidate',
          slots: resolveSlots(byLabel.question, block),
        };
      }
    }

    return {
      block,
      questionId: null,
      matchedBy: null,
      verdict: 'unmapped',
      slots: unmatchedSlots(block),
    };
  });
}

/** 복수응답 펼침에서 "선택 안 함"으로 읽는 표기. */
const NOT_SELECTED = new Set(['0', 'n', 'no', 'false', '아니오', '아니요', '미선택', '비선택', '해당없음', '없음']);

function isSelectedMark(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  return !NOT_SELECTED.has(value.toLowerCase());
}

export interface BlockAnswer {
  /** 저장할 값. 살아남은 값이 없으면 undefined — 빈 묶음으로 지난 회차 값을 덮지 않는다. */
  value: unknown;
  /** 어느 선택지·순위 보기에도 맞지 않아 버린 원본 값. 담당자에게 그대로 보여준다. */
  unmatchedValues: string[];
  /** 선택지 대조를 시도한 칸 수 — 실패 비율의 분모. */
  convertedCells: number;
}

/**
 * 블록의 셀 값들을 이 문항의 저장 형태 한 벌로 만든다.
 *
 * 블록 안에 빈 칸이 섞여 있어도 나머지 칸은 그대로 저장된다.
 *
 * @param cellValues block.columnIndexes 와 같은 순서·길이의 셀 텍스트
 */
export function buildBlockAnswer(
  question: Question,
  slots: readonly BlockSlot[],
  cellValues: readonly string[],
  /**
   * 확정된 값 대응 — 원본 값 → 선택지 저장값. 선택지 라벨이 지난 회차와 달라진 문항에서
   * 담당자가 화면에서 이어준 것이며, 다시 올릴 때 그대로 재사용된다.
   */
  valueAliases?: Readonly<Record<string, string>>,
): BlockAnswer {
  const unmatchedValues: string[] = [];
  let convertedCells = 0;

  if (question.type === 'table') {
    const cellById = new Map(
      collectAnswerableCells(question).map((entry) => [entry.cell.id, entry.cell]),
    );
    const answer: Record<string, unknown> = {};
    slots.forEach((slot, idx) => {
      if (slot.kind !== 'table-cell') return;
      const raw = (cellValues[idx] ?? '').trim();
      if (!raw) return;
      // 입력 칸은 원문 그대로. 선택 칸은 라벨 텍스트를 저장 키로 바꾼다 —
      // 라벨을 그대로 넣으면 화면에서 빈칸으로 보이는데 이월 값은 있는 것으로 판정돼,
      // "같음" 이 그 오염값을 올해 응답으로 복사한다.
      if (slot.cellType === 'input') {
        answer[slot.cellId] = raw;
        return;
      }
      const cell = cellById.get(slot.cellId);
      const options = cell ? cellOptions(cell) : [];
      convertedCells += 1;
      const option = findOptionByLabel(options, raw, valueAliases);
      if (!option) {
        unmatchedValues.push(raw);
        return;
      }
      answer[slot.cellId] =
        slot.cellType === 'checkbox' ? [cellOptionKey(option)] : cellOptionKey(option);
    });
    const value = Object.keys(answer).length > 0 ? answer : undefined;
    return { value, unmatchedValues, convertedCells };
  }

  if (question.type === 'checkbox') {
    const selected: string[] = [];
    slots.forEach((slot, idx) => {
      if (slot.kind !== 'checkbox-option') return;
      if (!isSelectedMark(cellValues[idx] ?? '')) return;
      selected.push(slot.optionValue);
    });
    return {
      value: selected.length > 0 ? selected : undefined,
      unmatchedValues,
      convertedCells,
    };
  }

  if (question.type === 'ranking') {
    const options = resolveRankingOptions(question);
    const answers: Array<{ rank: number; optionValue: string }> = [];
    slots.forEach((slot, idx) => {
      if (slot.kind !== 'ranking-rank') return;
      const raw = (cellValues[idx] ?? '').trim();
      if (!raw) return;
      convertedCells += 1;
      const option = findOptionByLabel(options, raw, valueAliases);
      if (!option) {
        unmatchedValues.push(raw);
        return;
      }
      answers.push({ rank: slot.rank, optionValue: option.value });
    });
    return {
      value: answers.length > 0 ? answers.sort((a, b) => a.rank - b.rank) : undefined,
      unmatchedValues,
      convertedCells,
    };
  }

  const singleIndex = slots.findIndex((slot) => slot.kind === 'single');
  if (singleIndex === -1) return { value: undefined, unmatchedValues, convertedCells };
  // 한 칸으로 값이 정해지지 않는 유형(다단계선택 배열·안내문 동의 객체 등)은 만들지 않는다.
  if (!SINGLE_CELL_TYPES.has(question.type)) {
    return { value: undefined, unmatchedValues, convertedCells };
  }
  const raw = (cellValues[singleIndex] ?? '').trim();
  if (!raw) return { value: undefined, unmatchedValues, convertedCells };

  // 선택지 문항은 엑셀의 라벨 텍스트를 저장값으로 바꾼다. 맞지 않으면 그 문항만 비운다.
  if (question.type === 'radio' || question.type === 'select') {
    convertedCells += 1;
    const option = findOptionByLabel(resolveChoiceOptions(question), raw, valueAliases);
    if (!option) {
      unmatchedValues.push(raw);
      return { value: undefined, unmatchedValues, convertedCells };
    }
    return { value: option.value, unmatchedValues, convertedCells };
  }

  return { value: raw, unmatchedValues, convertedCells };
}
