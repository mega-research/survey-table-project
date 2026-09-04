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
import type { OptionMismatch } from '@/lib/contacts/prior-answer-import';
import { OPT_TEXTS_KEY } from '@/lib/survey/response-sidecars';
import type { Question, RankingAnswer } from '@/types/survey';
import { resolveChoiceOptions } from '@/utils/choice-source';
import { RANKING_OTHER_VALUE } from '@/utils/ranking-shared';

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
  'table-cell',
  'radio-group',
  'table-cell-option-text',
  'ranking-rank',
  'ranking-other',
  'ranking-option-text',
  'table-cell-ranking',
  'table-cell-ranking-other',
  'table-cell-ranking-option-text',
]);

/**
 * 응답 저장 형태의 루트 사이드카에 담기는 열 종류 — 문항 답이 아니다.
 * 저장 경계가 `__` 접두 키를 따로 다루므로 여기서도 문항 답과 갈라 담는다.
 */
const SIDECAR_TYPES: ReadonlySet<SPSSExportColumn['type']> = new Set([
  'option-text',
  'other-text',
  // 표 셀의 상세 기재도 사이드카다. 문항 답으로 흘리면 그 셀의 선택값 자리에 덮어써져
  // 선택과 텍스트가 함께 망가진다.
  'table-cell-option-text',
]);

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
  /**
   * 문항별 선택지 변환 실패. 어느 보기에도 맞지 않은 코드는 그 문항만 비우고 여기 남는다 —
   * 대상은 통째로 교체되므로, 보고하지 않으면 같은 행의 다른 답이 살아남은 채 이 문항만
   * 조용히 사라진다.
   */
  optionMismatches: OptionMismatch[];
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
 * 복수 선택 열에서 "고르지 않음"으로 볼 값.
 *
 * 우리 내보내기는 미선택을 빈칸으로 낸다. 그런데 이 파일은 사람이 채워 돌려주는 것이라
 * 미선택을 `0` 으로 적어 오는 경우가 있다. 빈칸만 미선택으로 보면 그 `0` 이 전부 선택으로
 * 뒤집힌다.
 */
function isUnselectedCode(raw: string): boolean {
  return raw === '' || Number(raw) === 0;
}

/** 문항별 선택지 변환 실패 집계 — 어느 값이 어느 보기에도 안 맞았는지 그대로 남긴다. */
class MismatchCollector {
  private readonly stats = new Map<
    string,
    { total: number; unmatched: number; counts: Map<string, number> }
  >();

  private statOf(questionId: string) {
    const found = this.stats.get(questionId);
    if (found) return found;
    const created = { total: 0, unmatched: 0, counts: new Map<string, number>() };
    this.stats.set(questionId, created);
    return created;
  }

  /** 이 문항에서 코드 하나를 해석했다. `matchedValue` 가 없으면 실패다. */
  seen(questionId: string, raw: string, matched: boolean): void {
    const stat = this.statOf(questionId);
    stat.total += 1;
    if (matched) return;
    stat.unmatched += 1;
    stat.counts.set(raw, (stat.counts.get(raw) ?? 0) + 1);
  }

  /** 실패율이 높은 문항이 위로 온다 — 경고 수십 줄에 묻히면 "절반만 실패" 를 놓친다. */
  build(): OptionMismatch[] {
    const out: OptionMismatch[] = [];
    for (const [questionId, stat] of this.stats) {
      if (stat.unmatched === 0) continue;
      out.push({
        questionId,
        total: stat.total,
        unmatched: stat.unmatched,
        rate: stat.total > 0 ? stat.unmatched / stat.total : 0,
        values: [...stat.counts.entries()]
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
      });
    }
    return out.sort((a, b) => b.rate - a.rate || b.unmatched - a.unmatched);
  }
}

/** 한 문항 안에서 코드 해석 결과를 적어 두는 손잡이. */
interface MismatchSink {
  record(raw: string): void;
  ok(raw: string): void;
}

/**
 * 선택지 저장값. 응답 화면이 쓰는 것은 `option.value` 다 — 표에서 보기를 끌어오는 문항은
 * value 가 곧 셀 id 라 같은 규칙으로 맞는다. 코드를 그대로 넣으면 영구 미스매치가 된다.
 */
function storedValueOf(option: { id: string; value?: string | undefined }): string {
  return option.value || option.id;
}

/** 단일선택 코드값을 응답 저장값으로 되돌린다. 맞는 선택지가 없으면 undefined. */
function invertSingleChoice(question: Question, raw: string, mismatch: MismatchSink): unknown {
  const options = resolveChoiceOptions(question);
  const code = Number(raw);
  const found = Number.isFinite(code)
    ? options.find((option, idx) => (option.spssNumericCode ?? idx + 1) === code)
    : undefined;
  if (!found) {
    mismatch.record(raw);
    return undefined;
  }
  mismatch.ok(raw);
  return storedValueOf(found);
}

/**
 * 복수선택을 되돌린다. 내보내기는 보기마다 열 하나를 내고 선택된 것만 코드값을 넣으므로,
 * **값이 있는 열이 곧 선택**이다. 코드값 자체는 보지 않는다 — 열이 이미 어느 보기인지
 * 말하고 있고, 사람이 파일에서 1 을 다른 숫자로 바꿔 적어도 뜻은 같다.
 */
function invertCheckboxItems(
  question: Question,
  cells: ReadonlyArray<{ column: SPSSExportColumn; raw: string }>,
  mismatch: MismatchSink,
): unknown {
  const options = resolveChoiceOptions(question);
  const selected: string[] = [];
  for (const { column, raw } of cells) {
    if (isUnselectedCode(raw)) continue;
    const index = column.optionIndex;
    if (index == null) continue;
    const option = options[index];
    if (!option) {
      mismatch.record(raw);
      continue;
    }
    mismatch.ok(raw);
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
  mismatch: MismatchSink,
): unknown {
  const answer: Record<string, string | string[]> = {};
  for (const { column, raw } of cells) {
    const groupKey = column.choiceGroupKey;
    if (!groupKey) continue;
    if (column.type === 'choice-group') {
      const map = column.choiceGroupCellValueMap ?? {};
      const code = Number(raw);
      const cellId = Object.keys(map).find((id) => map[id] === code);
      if (!cellId) {
        mismatch.record(raw);
        continue;
      }
      mismatch.ok(raw);
      answer[groupKey] = cellId;
      continue;
    }
    // choice-group-item — 값이 있는 열이 곧 선택이다 (복수선택과 같은 규칙).
    if (isUnselectedCode(raw)) continue;
    const cellId = column.choiceGroupMemberCellId;
    if (!cellId) {
      mismatch.record(raw);
      continue;
    }
    mismatch.ok(raw);
    const bucket = answer[groupKey];
    if (Array.isArray(bucket)) bucket.push(cellId);
    else answer[groupKey] = [cellId];
  }
  return Object.keys(answer).length > 0 ? answer : undefined;
}

/**
 * 순위형을 되돌린다. 저장 형태는 `{ rank, optionValue, optionText? }` 배열이다.
 *
 * 순위마다 열이 하나씩 나가므로 열의 `rankIndex` 가 곧 순위다. 기타는 매직값
 * `__other__` 로 저장되고 텍스트가 따로 열로 나간다 — 코드 열이 비어 있는데 기타
 * 텍스트 열에만 값이 있으면 그 순위는 기타를 고른 것이다.
 *
 * 텍스트가 들어가는 칸이 둘이라 헷갈리기 쉽다. 기타 자유 기입은 `otherText`, 고른 보기에
 * 딸린 상세 기재는 `optionText` 다. 내보내기도 `_etc` 와 `_text` 로 열을 따로 낸다.
 *
 * 보기 그룹이 걸린 순위형은 저장 형태가 그룹키 → 배열 맵이다. 열이 그룹키를 들고
 * 있으므로 그것으로 갈라 담는다. 그룹이 없으면 평평한 배열 하나다.
 */
function invertRanking(
  cells: ReadonlyArray<{ column: SPSSExportColumn; raw: string }>,
  mismatch: MismatchSink,
): unknown {
  /** 그룹키(없으면 빈 문자열) → 순위 → 만들던 항목 */
  const byGroup = new Map<string, Map<number, RankingAnswer>>();
  const entryAt = (groupKey: string, rank: number): RankingAnswer => {
    const group = byGroup.get(groupKey) ?? new Map<number, RankingAnswer>();
    byGroup.set(groupKey, group);
    const found = group.get(rank);
    if (found) return found;
    const created: RankingAnswer = { rank, optionValue: '' };
    group.set(rank, created);
    return created;
  };

  for (const { column, raw } of cells) {
    const rank = column.rankIndex;
    if (rank == null) continue;
    const groupKey = column.choiceGroupKey ?? '';
    const entry = entryAt(groupKey, rank);

    if (column.type === 'ranking-rank') {
      const code = Number(raw);
      const found = column.cellOptions?.find(
        (option, idx) => (option.spssNumericCode ?? idx + 1) === code,
      );
      if (!found) {
        mismatch.record(raw);
        continue;
      }
      mismatch.ok(raw);
      entry.optionValue = storedValueOf(found);
      continue;
    }
    if (column.type === 'ranking-other') {
      // 기타 텍스트가 있으면 그 순위는 기타를 고른 것이다. 기타 텍스트가 담기는 자리는
      // `otherText` 다 — `optionText` 는 고른 보기에 딸린 상세 기재라 다른 칸이다
      // (내보내기도 두 열을 따로 낸다).
      entry.optionValue = RANKING_OTHER_VALUE;
      entry.otherText = raw;
      continue;
    }
    // ranking-option-text — 고른 보기에 딸린 상세 기재.
    entry.optionText = raw;
  }

  const build = (group: Map<number, RankingAnswer>): RankingAnswer[] =>
    [...group.values()]
      .filter((entry) => entry.optionValue.length > 0)
      .sort((a, b) => a.rank - b.rank);

  const flat = byGroup.get('');
  if (byGroup.size === 1 && flat) {
    const list = build(flat);
    return list.length > 0 ? list : undefined;
  }
  const grouped: Record<string, RankingAnswer[]> = {};
  for (const [groupKey, group] of byGroup) {
    if (!groupKey) continue;
    const list = build(group);
    if (list.length > 0) grouped[groupKey] = list;
  }
  return Object.keys(grouped).length > 0 ? grouped : undefined;
}

/**
 * 표 안 순위 셀을 되돌린다. 저장 자리는 표 응답 맵의 셀 id 이고, 그 값이 순위 배열이다 —
 * 질문 레벨 순위형과 같은 모양이라 셀별로 갈라 담기만 하면 된다.
 */
function invertTableCellRanking(
  cells: ReadonlyArray<{ column: SPSSExportColumn; raw: string }>,
  mismatch: MismatchSink,
): unknown {
  const byCell = new Map<string, Array<{ column: SPSSExportColumn; raw: string }>>();
  for (const cell of cells) {
    const cellId = cell.column.tableCellId;
    if (!cellId) continue;
    const bucket = byCell.get(cellId);
    if (bucket) bucket.push(cell);
    else byCell.set(cellId, [cell]);
  }
  const answer: Record<string, unknown> = {};
  for (const [cellId, group] of byCell) {
    const value = invertRanking(group, mismatch);
    if (value !== undefined) answer[cellId] = value;
  }
  return Object.keys(answer).length > 0 ? answer : undefined;
}

/** 라디오 그룹 멤버 셀의 보기 하나 — 그룹은 보기 1개짜리 셀만 묶는다. */
function firstRadioOptionId(question: Question, cellId: string): string | undefined {
  for (const row of question.tableRowsData ?? []) {
    for (const cell of row.cells ?? []) {
      if (cell.id !== cellId) continue;
      return cell.radioOptions?.[0]?.id;
    }
  }
  return undefined;
}

/**
 * 표 문항을 되돌린다. 저장 형태는 셀 id → 값 하나의 맵이다.
 *
 * 셀 종류마다 규칙이 다르다.
 * - 선택 셀(radio·select): 코드값 → 그 셀의 보기 id
 * - 복수 선택 셀: 보기마다 열이 하나씩이고 값이 있는 열이 곧 선택 — 배열로 모은다
 * - 입력·계산 셀: 값 그대로
 * - 라디오 그룹: 여러 셀이 변수 하나로 합쳐진다. 코드가 가리키는 셀을 찾아 그 셀의
 *   보기 하나를 선택으로 적는다 (옵션 1개짜리 셀만 그룹이 된다)
 */
function invertTableCells(
  question: Question,
  cells: ReadonlyArray<{ column: SPSSExportColumn; raw: string }>,
  mismatch: MismatchSink,
): unknown {
  const answer: Record<string, unknown> = {};
  for (const { column, raw } of cells) {
    if (column.type === 'radio-group') {
      const map = column.radioGroupCellValueMap ?? {};
      const code = Number(raw);
      const cellId = Object.keys(map).find((id) => map[id] === code);
      // 그룹 멤버는 보기 1개짜리 셀이다 — 그 보기 id 가 곧 이 셀의 응답값이다.
      const optionId = cellId ? firstRadioOptionId(question, cellId) : undefined;
      if (!cellId || !optionId) {
        mismatch.record(raw);
        continue;
      }
      mismatch.ok(raw);
      answer[cellId] = optionId;
      continue;
    }
    const cellId = column.tableCellId;
    if (!cellId) continue;

    // 복수 선택 셀 — 보기별 열이라 값이 있는 열이 곧 선택이다.
    if (column.tableCellType === 'checkbox' && column.optionIndex != null) {
      if (isUnselectedCode(raw)) continue;
      const option = column.cellOptions?.[column.optionIndex];
      // 셀 컨트롤이 저장하는 키는 `option.value ?? option.id` 다. 열 메타의 optionValue 는
      // value 만 담아 값이 없는 보기에서 비므로 여기서 id 로 떨어뜨린다.
      const stored = column.optionValue ?? option?.id;
      if (stored == null) {
        mismatch.record(raw);
        continue;
      }
      mismatch.ok(raw);
      const bucket = answer[cellId];
      if (Array.isArray(bucket)) bucket.push(stored);
      else answer[cellId] = [stored];
      continue;
    }

    // 선택 셀 — 코드값을 그 셀의 보기 id 로 되돌린다.
    if (
      (column.tableCellType === 'radio' || column.tableCellType === 'select') &&
      column.cellOptions &&
      column.cellOptions.length > 0
    ) {
      const code = Number(raw);
      const found = column.cellOptions.find(
        (option, idx) => (option.spssNumericCode ?? idx + 1) === code,
      );
      if (!found) {
        mismatch.record(raw);
        continue;
      }
      // 셀 컨트롤이 저장하는 키와 같은 규칙이다 — id 로 넣으면 값이 다른 보기에서
      // 선택이 풀린 것처럼 보이고 표시 조건·검증이 어긋난다.
      answer[cellId] = found.value ?? found.id;
      continue;
    }

    // 입력·계산 셀 — 값 그대로.
    answer[cellId] = raw;
  }
  return Object.keys(answer).length > 0 ? answer : undefined;
}

/**
 * 사이드카 텍스트가 어느 보기에 붙는지. `option-text` 는 열 정의가 보기 id 를 들고 있고,
 * `other-text` 는 기타 보기 하나뿐이라 그 보기를 찾아 쓴다.
 */
function resolveSidecarOptionId(question: Question, column: SPSSExportColumn): string | undefined {
  // 표 셀 사이드카도 저장 자리가 같다 — __optTexts__[questionId][optionId].
  if (column.type === 'option-text' || column.type === 'table-cell-option-text') {
    return column.optionId;
  }
  const options = resolveChoiceOptions(question);
  return options.find((option) => option.id === 'other-option')?.id;
}

/** 문항 하나에 붙은 열들을 응답 저장값 하나로 되돌린다. 되돌릴 수 없으면 undefined. */
function invertQuestion(
  question: Question,
  cells: ReadonlyArray<{ column: SPSSExportColumn; raw: string }>,
  mismatch: MismatchSink,
): unknown {
  const first = cells[0];
  if (!first) return undefined;
  switch (first.column.type) {
    case 'single':
      return invertSingleChoice(question, first.raw, mismatch);
    case 'text':
      return first.raw;
    case 'multiselect':
      return invertMultiselect(first.raw);
    case 'checkbox-item':
      return invertCheckboxItems(question, cells, mismatch);
    case 'choice-group':
    case 'choice-group-item':
      return invertChoiceGroups(cells, mismatch);
    case 'table-cell':
    case 'radio-group':
      return invertTableCells(question, cells, mismatch);
    case 'ranking-rank':
    case 'ranking-other':
    case 'ranking-option-text':
      return invertRanking(cells, mismatch);
    case 'table-cell-ranking':
    case 'table-cell-ranking-other':
    case 'table-cell-ranking-option-text':
      return invertTableCellRanking(cells, mismatch);
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

  const mismatches = new MismatchCollector();
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
      const sink: MismatchSink = {
        record: (raw) => mismatches.seen(questionId, raw, false),
        ok: (raw) => mismatches.seen(questionId, raw, true),
      };
      const value = invertQuestion(question, answerCells, sink);
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
    optionMismatches: mismatches.build(),
    emptyMatchRows,
    duplicateMatchValues: [...duplicateMatchValues],
    unknownVarNames: [...new Set(unknownVarNames)],
    skippedByRuleVarNames: [...new Set(skippedByRuleVarNames)],
    unsupportedVarNames: [...new Set(unsupportedVarNames)],
  };
}
