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
const INVERTIBLE_TYPES: ReadonlySet<SPSSExportColumn['type']> = new Set(['single', 'text']);

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

/** 단일선택 코드값을 응답 저장값으로 되돌린다. 맞는 선택지가 없으면 undefined. */
function invertSingleChoice(question: Question, raw: string): unknown {
  const options = resolveChoiceOptions(question);
  const code = Number(raw);
  if (!Number.isFinite(code)) return undefined;
  const index = options.findIndex((option, idx) => (option.spssNumericCode ?? idx + 1) === code);
  const found = options[index];
  if (!found) return undefined;
  // 응답 저장값은 option.value 다. 표에서 보기를 끌어오는 문항은 value 가 곧 셀 id 라
  // 같은 규칙으로 맞는다 — 코드를 그대로 넣으면 영구 미스매치가 된다.
  return found.value || found.id;
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
    for (const { columnIndex, column, question } of mapped) {
      const cell = (row[columnIndex] ?? '').trim();
      // 빈칸은 키를 만들지 않는다.
      if (!cell) continue;
      const value = column.type === 'single' ? invertSingleChoice(question, cell) : cell;
      if (value === undefined) continue;
      answers[question.id] = value;
    }

    if (Object.keys(answers).length === 0) continue;
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
