/**
 * Raw 양식 이월 응답 임포트 — 우리 Raw Data 내보내기 파일을 되읽는다 (순수).
 *
 * 클라이언트가 지난 회차 rawdata 를 **우리 내보내기 양식 그대로** 채워 돌려주는 경로다.
 * 임의 엑셀을 문항코드 유사도로 이어주는 기존 마법사(`prior-answer-import`)와 달리
 * 사람이 열을 잇지 않는다 — Raw Data 시트 **3행의 SPSS 변수명**이 기계 식별자라
 * 우리가 같은 설문으로 열 정의를 다시 만들어 짝을 지으면 왕복이 정확히 맞는다.
 *
 * 시트 모양(내보내기와 같은 순서):
 *   1행 질문 제목 / 2행 표 셀·옵션 라벨 / 3행 SPSS 변수명 / 4행부터 값(선택지는 코드값)
 *   왼쪽 메타 열(IP 해시·시스템ID·순번·명단 열·개별 URL·상태·시각·단말)은 1~3행이
 *   세로 병합이라 3행이 비어 있다 — 그래서 변수 열과 저절로 갈린다.
 *
 * **되읽지 않는 열이 규칙으로 정해져 있다.**
 * - 변동 확인(`_CHG`): 지난 회차 답이 아니라 이번 회차에 응답자가 밝힌 행위 기록이다.
 * - 공지 동의·동의 일시: 동의는 이번 회차에 다시 받는다.
 * 둘 다 조용히 버리지 않고 목록으로 보고한다.
 *
 * **빈칸은 키를 만들지 않는다.** 값이 없는 열은 이월 응답에 넣지 않는다 — 이월 응답의
 * 문항 키 집합이 변동 확인 변수를 만들 문항을 정하므로, 빈칸이 키가 되면 지난 답이 없는
 * 문항에도 변수가 생겨 내보내기가 오염된다.
 */
import type { SPSSExportColumn } from '@/lib/analytics/spss-excel-export';
import { OPT_TEXTS_KEY } from '@/lib/survey/response-sidecars';
import type { Question } from '@/types/survey';
import { resolveChoiceOptions } from '@/utils/choice-source';

import { normalizeMatchValue } from './prior-answer-import';

/** Raw Data 시트의 헤더 행 수. 1행 제목 / 2행 셀·옵션 라벨 / 3행 변수명. */
export const RAW_FORMAT_HEADER_ROWS = 3;

/** 규칙상 되읽지 않는 열 종류. 값이 있어도 이월 응답에 넣지 않는다. */
const SKIP_BY_RULE_TYPES: ReadonlySet<SPSSExportColumn['type']> = new Set([
  'change-confirm',
  'notice-agree',
  'notice-date',
]);

/** 지금 되돌릴 수 있는 열 종류. 나머지는 보고하고 건너뛴다. */
const INVERTIBLE_TYPES: ReadonlySet<SPSSExportColumn['type']> = new Set([
  'single',
  'text',
  'checkbox-item',
  'multiselect',
  'choice-group',
  'choice-group-item',
  'option-text',
  'other-text',
]);

/**
 * 응답 저장 형태의 루트 사이드카에 담기는 열 종류 — 문항 답이 아니다.
 * 저장 경계가 `__` 접두 키를 따로 다루므로 여기서도 문항 답과 갈라 담는다.
 */
const SIDECAR_TYPES: ReadonlySet<SPSSExportColumn['type']> = new Set(['option-text', 'other-text']);

export interface RawFormatImportInput {
  /** 헤더 행 격자 — 3행이어야 한다. 컬럼 인덱스 순서 그대로. */
  headerRows: ReadonlyArray<ReadonlyArray<string>>;
  /** 데이터 행. 컬럼 인덱스 순서 그대로. */
  rows: ReadonlyArray<ReadonlyArray<string>>;
  /** 대조값이 들어 있는 컬럼 인덱스 */
  matchColumnIndex: number;
  /** 이 설문의 내보내기 열 정의 (generateSPSSColumns 로 다시 만든 것) */
  columns: ReadonlyArray<SPSSExportColumn>;
  questions: ReadonlyArray<Question>;
}

export interface RawFormatImportResult {
  /** 대조값별 값 묶음. 값이 없는 대상과 파일 안에서 중복된 대조값은 담지 않는다. */
  records: Array<{ matchValue: string; answers: Record<string, unknown> }>;
  emptyMatchRows: number;
  duplicateMatchValues: string[];
  /** 이 설문의 변수명과 맞지 않아 건너뛴 열의 3행 값 */
  unknownVarNames: string[];
  /** 규칙상 되읽지 않는 열 (변동 확인·공지 동의) */
  skippedByRuleVarNames: string[];
  /** 아직 되돌릴 수 없는 열 종류라 건너뛴 열 */
  unsupportedVarNames: string[];
}

/**
 * 시트 3행에 이 설문의 SPSS 변수명이 하나라도 있으면 우리 Raw 양식으로 본다.
 * 자동 추측일 뿐이고 확정은 사람이 한다.
 *
 * @param sheetRows 시트 **처음부터의** 행들. 헤더 몇 행으로 읽었는지와 무관하게 판정해야
 *   해서 헤더 격자가 아니라 시트 행을 받는다 — 담당자가 헤더 1행으로 열어 둔 상태에서도
 *   "이 파일은 우리 양식입니다" 를 알려줄 수 있어야 한다.
 */
export function looksLikeRawFormat(
  sheetRows: ReadonlyArray<ReadonlyArray<string>>,
  columns: ReadonlyArray<SPSSExportColumn>,
): boolean {
  const varRow = sheetRows[RAW_FORMAT_HEADER_ROWS - 1];
  if (!varRow) return false;
  const known = new Set(columns.map((c) => c.spssVarName));
  return varRow.some((text) => known.has(text.trim()));
}

/**
 * 선택지 저장값. 응답 화면이 쓰는 것은 `option.value` 다 — 표에서 보기를 끌어오는 문항은
 * value 가 곧 셀 id 라 같은 규칙으로 맞는다. 코드를 그대로 넣으면 영구 미스매치가 된다.
 */
function storedValueOf(option: { id: string; value?: string | undefined }): string {
  return option.value || option.id;
}

/** 단일선택 코드값을 응답 저장값으로 되돌린다. 맞는 선택지가 없으면 undefined. */
function invertSingleChoice(question: Question, raw: string): unknown {
  const options = resolveChoiceOptions(question);
  const code = Number(raw);
  if (!Number.isFinite(code)) return undefined;
  const found = options.find((option, idx) => (option.spssNumericCode ?? idx + 1) === code);
  return found ? storedValueOf(found) : undefined;
}

/**
 * 복수선택을 되돌린다. 내보내기는 보기마다 열 하나를 내고 선택된 것만 코드값을 넣으므로,
 * **값이 있는 열이 곧 선택**이다. 코드값 자체는 보지 않는다 — 열이 이미 어느 보기인지
 * 말하고 있고, 사람이 파일에서 1 을 다른 숫자로 바꿔 적어도 뜻은 같다.
 */
function invertCheckboxItems(
  question: Question,
  cells: ReadonlyArray<{ column: SPSSExportColumn; raw: string }>,
): unknown {
  const options = resolveChoiceOptions(question);
  const selected: string[] = [];
  for (const { column, raw } of cells) {
    if (!raw) continue;
    const index = column.optionIndex;
    if (index == null) continue;
    const option = options[index];
    if (!option) continue;
    selected.push(storedValueOf(option));
  }
  return selected.length > 0 ? selected : undefined;
}

/** 다단계 선택. 내보내기가 밑줄로 이어 붙이므로 되돌릴 때 그대로 가른다. */
function invertMultiselect(raw: string): unknown {
  const parts = raw.split('_').filter((part) => part.length > 0);
  return parts.length > 0 ? parts : undefined;
}

/**
 * 보기 그룹 문항을 되돌린다. 저장 형태는 그룹키 → 선택(단일은 셀 id, 복수는 셀 id 배열).
 * 코드 → 셀 id 는 내보내기가 쓴 맵을 뒤집어 얻는다.
 */
function invertChoiceGroups(
  cells: ReadonlyArray<{ column: SPSSExportColumn; raw: string }>,
): unknown {
  const answer: Record<string, string | string[]> = {};
  for (const { column, raw } of cells) {
    if (!raw) continue;
    const groupKey = column.choiceGroupKey;
    if (!groupKey) continue;
    if (column.type === 'choice-group') {
      const map = column.choiceGroupCellValueMap ?? {};
      const code = Number(raw);
      const cellId = Object.keys(map).find((id) => map[id] === code);
      if (cellId) answer[groupKey] = cellId;
      continue;
    }
    // choice-group-item — 값이 있는 열이 곧 선택이다 (복수선택과 같은 규칙).
    const cellId = column.choiceGroupMemberCellId;
    if (!cellId) continue;
    const bucket = answer[groupKey];
    if (Array.isArray(bucket)) bucket.push(cellId);
    else answer[groupKey] = [cellId];
  }
  return Object.keys(answer).length > 0 ? answer : undefined;
}

/**
 * 사이드카 텍스트가 어느 보기에 붙는지. `option-text` 는 열 정의가 보기 id 를 들고 있고,
 * `other-text` 는 기타 보기 하나뿐이라 그 보기를 찾아 쓴다.
 */
function resolveSidecarOptionId(question: Question, column: SPSSExportColumn): string | undefined {
  if (column.type === 'option-text') return column.optionId;
  const options = resolveChoiceOptions(question);
  return options.find((option) => option.id === 'other-option')?.id;
}

/** 문항 하나에 붙은 열들을 응답 저장값 하나로 되돌린다. 되돌릴 수 없으면 undefined. */
function invertQuestion(
  question: Question,
  cells: ReadonlyArray<{ column: SPSSExportColumn; raw: string }>,
): unknown {
  const first = cells[0];
  if (!first) return undefined;
  switch (first.column.type) {
    case 'single':
      return invertSingleChoice(question, first.raw);
    case 'text':
      return first.raw;
    case 'multiselect':
      return invertMultiselect(first.raw);
    case 'checkbox-item':
      return invertCheckboxItems(question, cells);
    case 'choice-group':
    case 'choice-group-item':
      return invertChoiceGroups(cells);
    default:
      return undefined;
  }
}

/**
 * Raw 양식 시트를 대조값별 값 묶음으로 바꾼다.
 *
 * 열 짝짓기는 3행 변수명 하나로만 한다. 사람이 잇지 않으므로 어긋난 열은 조용히
 * 흘려보내지 않고 종류별로 나눠 보고한다.
 */
export function buildRawFormatRecords(input: RawFormatImportInput): RawFormatImportResult {
  const questionById = new Map(input.questions.map((q) => [q.id, q]));
  const columnByVarName = new Map(input.columns.map((c) => [c.spssVarName, c]));

  const varRow = input.headerRows[RAW_FORMAT_HEADER_ROWS - 1] ?? [];
  const mapped: Array<{ columnIndex: number; column: SPSSExportColumn; question: Question }> = [];
  const unknownVarNames: string[] = [];
  const skippedByRuleVarNames: string[] = [];
  const unsupportedVarNames: string[] = [];

  varRow.forEach((text, columnIndex) => {
    const varName = text.trim();
    // 메타 열은 1~3행 세로 병합이라 3행이 비어 있다. 변수 열이 아니므로 보고하지 않는다.
    if (!varName) return;
    const column = columnByVarName.get(varName);
    if (!column) {
      unknownVarNames.push(varName);
      return;
    }
    if (SKIP_BY_RULE_TYPES.has(column.type)) {
      skippedByRuleVarNames.push(varName);
      return;
    }
    if (!INVERTIBLE_TYPES.has(column.type)) {
      unsupportedVarNames.push(varName);
      return;
    }
    const question = questionById.get(column.questionId);
    if (!question) {
      unknownVarNames.push(varName);
      return;
    }
    mapped.push({ columnIndex, column, question });
  });

  // 한 문항이 여러 열로 나가는 종류(복수선택·보기 그룹)가 있어 문항 단위로 묶어 되돌린다.
  const byQuestion = new Map<string, typeof mapped>();
  for (const entry of mapped) {
    const bucket = byQuestion.get(entry.question.id);
    if (bucket) bucket.push(entry);
    else byQuestion.set(entry.question.id, [entry]);
  }

  const byMatchValue = new Map<string, Record<string, unknown>>();
  const seenMatchValues = new Set<string>();
  const duplicateMatchValues = new Set<string>();
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
    const optTexts: Record<string, Record<string, string>> = {};

    for (const [questionId, entries] of byQuestion) {
      const question = entries[0]?.question;
      if (!question) continue;
      // 빈칸은 값이 아니다 — 여기서 한 번 걸러 아래 역변환기가 빈칸을 보지 않게 한다.
      const cells = entries
        .map((entry) => ({ column: entry.column, raw: (row[entry.columnIndex] ?? '').trim() }))
        .filter((cell) => cell.raw.length > 0);
      if (cells.length === 0) continue;

      // 사이드카는 문항 답이 아니라 루트 사이드카로 간다.
      for (const cell of cells) {
        if (!SIDECAR_TYPES.has(cell.column.type)) continue;
        const optionId = resolveSidecarOptionId(question, cell.column);
        if (!optionId) continue;
        const bucket = optTexts[questionId] ?? {};
        bucket[optionId] = cell.raw;
        optTexts[questionId] = bucket;
      }

      const answerCells = cells.filter((cell) => !SIDECAR_TYPES.has(cell.column.type));
      if (answerCells.length === 0) continue;
      const value = invertQuestion(question, answerCells);
      if (value === undefined) continue;
      answers[questionId] = value;
    }

    if (Object.keys(optTexts).length > 0) answers[OPT_TEXTS_KEY] = optTexts;
    // 사이드카만 있고 문항 답이 하나도 없으면 담지 않는다 — 붙일 답이 없다.
    if (Object.keys(answers).filter((key) => !key.startsWith('__')).length === 0) continue;
    byMatchValue.set(matchValue, answers);
  }

  // 중복 대조값은 통째로 뺀다 — 남은 한 행을 고르는 규칙이 없다.
  for (const value of duplicateMatchValues) byMatchValue.delete(value);

  return {
    records: [...byMatchValue.entries()].map(([matchValue, answers]) => ({ matchValue, answers })),
    emptyMatchRows,
    duplicateMatchValues: [...duplicateMatchValues],
    unknownVarNames: [...new Set(unknownVarNames)],
    skippedByRuleVarNames: [...new Set(skippedByRuleVarNames)],
    unsupportedVarNames: [...new Set(unsupportedVarNames)],
  };
}
