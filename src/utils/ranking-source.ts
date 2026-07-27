import type { Question, QuestionOption, TableCell, TableRow } from '@/types/survey';

import { RANKING_OTHER_VALUE } from './ranking-shared';

/**
 * tableRowsData 에서 유효한 `ranking_opt`(rnk) 셀을 순서대로 수집.
 * rowspan/colspan continuation 으로 숨겨진 셀(isHidden)은 제외.
 * Case 2 옵션 소스 변환 / 유효성 검사 / UI 카운트 등 여러 곳에서 공유하는 단일 진실.
 */
export function collectRankingOptCells(
  tableRowsData: TableRow[] | undefined,
): TableCell[] {
  if (!tableRowsData) return [];
  const cells: TableCell[] = [];
  for (const row of tableRowsData) {
    for (const cell of row.cells) {
      if (cell.type !== 'ranking_opt') continue;
      if (cell.isHidden) continue;
      cells.push(cell);
    }
  }
  return cells;
}

/**
 * ranking_opt 셀의 표시 라벨을 결정.
 * 우선순위: content(사용자 가시 텍스트) > rankingLabel(SPSS 라벨용) > fallback.
 */
function buildRankingOptLabel(cell: TableCell, fallback: string): string {
  return (cell.content ?? '').trim() || (cell.rankingLabel ?? '').trim() || fallback;
}

/**
 * ranking_opt 셀 배열을 QuestionOption 배열로 변환.
 *
 * - id/value: cell.id (UUID — 셀 이동/라벨 변경에 강건)
 * - label: content > rankingLabel > '(라벨 없음)'
 * - spssNumericCode: 셀의 spssNumericCode 우선, 없으면 **전달된 셀 배열 내 1-based 순번**.
 *   비그룹 경로는 전체 셀을 전달하므로 기존 질문-전체 순번과 동일(동작 불변).
 *   그룹별 호출 시 자연스럽게 그룹 내 순번이 된다(checkbox 그룹 컨벤션).
 * - isOtherRankingCell=true 셀: value=RANKING_OTHER_VALUE, spssNumericCode 없음.
 *   선택 시 기타 자유입력 UI 가 나타나고 `_rk{k}` 는 system-missing 으로 기록됨.
 */
export function resolveRankingOptionsFromCells(cells: TableCell[]): QuestionOption[] {
  return cells.map((cell, idx) => {
    if (cell.isOtherRankingCell === true) {
      return {
        id: cell.id,
        value: RANKING_OTHER_VALUE,
        label: buildRankingOptLabel(cell, '기타 (직접 입력)'),
        ...(cell.allowTextInput !== undefined ? { allowTextInput: cell.allowTextInput } : {}),
        ...(cell.textInputPlaceholder !== undefined
          ? { textInputPlaceholder: cell.textInputPlaceholder }
          : {}),
        ...(cell.textBold ? { textBold: true } : {}),
        ...(cell.backgroundColor ? { backgroundColor: cell.backgroundColor } : {}),
      };
    }
    return {
      id: cell.id,
      value: cell.id,
      label: buildRankingOptLabel(cell, '(라벨 없음)'),
      spssNumericCode: cell.spssNumericCode ?? idx + 1,
      ...(cell.allowTextInput !== undefined ? { allowTextInput: cell.allowTextInput } : {}),
      ...(cell.textInputPlaceholder !== undefined
        ? { textInputPlaceholder: cell.textInputPlaceholder }
        : {}),
      ...(cell.textBold ? { textBold: true } : {}),
      ...(cell.backgroundColor ? { backgroundColor: cell.backgroundColor } : {}),
    };
  });
}

/**
 * 순위형 질문의 옵션 소스를 통합 반환.
 * - 수동 (optionsSource !== 'table'): question.options 그대로
 * - 테이블 옵션 (optionsSource === 'table'): 자신의 tableRowsData 에서 'ranking_opt' 셀을 옵션으로 수집.
 *   셀→옵션 변환은 resolveRankingOptionsFromCells 에 위임.
 */
export function resolveRankingOptions(question: Question): QuestionOption[] {
  if (question.rankingConfig?.optionsSource !== 'table') {
    return question.options ?? [];
  }

  const cells = collectRankingOptCells(question.tableRowsData);
  return resolveRankingOptionsFromCells(cells);
}

/**
 * 같은 tableRowsData 내에 isOtherRankingCell=true 인 유효 셀이 있는지.
 * 주어진 `excludeCellId` 가 있으면 해당 셀은 제외 (자기 자신 검사 제외용).
 *
 * 사용처:
 * - 셀 편집 모달 저장 검증 (질문당 1개 강제)
 * - 단일 셀 복사/붙여넣기 중복 감지
 * - 셀 라이브러리 로드 중복 감지
 */
export function hasExistingOtherRankingCell(
  rows: TableRow[] | undefined,
  excludeCellId?: string,
): boolean {
  if (!rows) return false;
  return rows.some((row) =>
    row.cells.some(
      (c) =>
        c.id !== excludeCellId
        && c.type === 'ranking_opt'
        && !c.isHidden
        && c.isOtherRankingCell === true,
    ),
  );
}

/**
 * Case 2 질문 내에 `isOtherRankingCell=true` 인 (유효한) ranking_opt 셀이 있는지.
 * SPSS/엑셀 내보내기에서 `_rk{k}_etc` 변수 생성 여부 판정에 사용.
 */
export function hasOtherRankingCell(question: Question): boolean {
  if (question.rankingConfig?.optionsSource !== 'table') return false;
  return hasExistingOtherRankingCell(question.tableRowsData);
}

/**
 * QuestionOption 배열에서 SPSS 값 라벨 쌍(숫자코드 + 라벨)을 추출.
 * 기타(value === RANKING_OTHER_VALUE) 엔트리는 numeric 변수가 system-missing 이므로 제외.
 * `spssNumericCode` 가 없는 옵션은 원본 순서 기준 1-based 인덱스로 폴백.
 */
export function toSpssValueLabelPairs(
  opts: QuestionOption[] | undefined,
): Array<{ code: number | string; label: string }> {
  if (!opts || opts.length === 0) return [];
  return opts
    .map((opt, i) => ({
      code: opt.spssNumericCode ?? i + 1,
      label: opt.label,
      isOther: opt.value === RANKING_OTHER_VALUE,
    }))
    .filter((p) => !p.isOther)
    .map(({ code, label }) => ({ code, label }));
}
