import type { CSSProperties } from 'react';

import type { TableCell } from '@/types/survey';

const LABEL_WRAP_THRESHOLD = 10;

/**
 * 라벨 길이 기반 옵션 그리드 열 수 휴리스틱.
 * - 빈 배열은 0 반환 — 호출자가 분기에 사용.
 * - 최대 라벨 길이가 LABEL_WRAP_THRESHOLD 초과면 1열, 이하면 2열.
 */
export function computeMobileOptionsColumnsByLabels(labels: ReadonlyArray<string | undefined>): number {
  if (labels.length === 0) return 0;
  const longest = labels.reduce(
    (max, label) => Math.max(max, label?.length ?? 0),
    0,
  );
  return longest > LABEL_WRAP_THRESHOLD ? 1 : 2;
}

/**
 * 모바일 카드(RowCard) 안 옵션 그리드의 열 수 결정 (TableCell 입력).
 */
export function computeMobileCardOptionsColumns(cell: TableCell): number {
  const opts =
    cell.radioOptions ?? cell.checkboxOptions ?? cell.selectOptions ?? [];
  return computeMobileOptionsColumnsByLabels(opts.map((o) => o.label));
}

/**
 * globals.css 의 `.options-grid` 는 모바일(<640px)에서 1열로 강제하므로,
 * 모바일에서 N열을 적용하려는 경우 inline gridTemplateColumns 로 override.
 * 일반 응답 페이지의 라디오/체크박스가 모바일에서도 휴리스틱 N열을 유지하기 위함.
 */
export function applyMobileOptionsGridOverride(
  baseStyle: CSSProperties | undefined,
  columns: number | undefined,
): CSSProperties | undefined {
  if (!columns || columns < 2) return baseStyle;
  return { ...baseStyle, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };
}

/**
 * 카드 안 셀의 optionsColumns 를 라벨 길이 휴리스틱으로 override.
 * 옵션이 없거나 이미 같은 값이면 원본 cell 그대로 반환 (참조 보존).
 * "가로 한 줄"(optionsColumns === 0, flex-wrap)은 저작자 명시 레이아웃이므로
 * override 하지 않는다 — 0~10점 스케일 같은 짧은 라벨 다수가 카드 안에서도
 * 폭을 채우며 여러 줄로 wrap 되게 유지.
 */
export function overrideCellOptionsColumnsForCard<T extends TableCell>(cell: T): T {
  if (cell.optionsColumns === 0) return cell;
  const cols = computeMobileCardOptionsColumns(cell);
  if (cols === 0 || cell.optionsColumns === cols) return cell;
  return { ...cell, optionsColumns: cols };
}

/**
 * 열 라벨이 "_단위" 또는 "단위" 로 끝나는 셀쌍(수량 셀 + 단위 셀)을 한 줄로 묶기 위한 감지 헬퍼.
 * 다음 셀의 열 라벨을 받아 묶을지 여부와, 현재 셀이 이미 묶인 단위 셀인지 반환.
 */
export function detectUnitPair(
  currentLabel: string,
  nextLabel: string | undefined,
  prevLabel: string | undefined,
): { isUnitPairStart: boolean; wasAlreadyPaired: boolean } {
  // 다음 셀 라벨이 "단위" 로 끝나면 현재 셀과 한 줄로 묶는다(시작 판정).
  const isUnitPairStart = !!nextLabel && nextLabel.endsWith('단위');
  // 위 시작 판정은 prevLabel 과 무관하게 "단위" 로 끝나는 셀이면 직전 셀이 항상 인라인한다.
  // 따라서 이미 묶인 셀 판정도 동일한 broad 규칙으로 대칭을 맞춰야 중복 렌더를 막는다.
  // (이전: isUnitCell 이 '_단위'/정확히 '단위' 만 보던 narrow 규칙이라 '원단위' 등이 두 번 렌더됨)
  const wasAlreadyPaired = !!prevLabel && currentLabel.endsWith('단위');
  return { isUnitPairStart, wasAlreadyPaired };
}
