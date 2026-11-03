import type { SPSSExportColumn } from '@/lib/analytics/spss-excel-export';

/** 보기·칸에 딸린 글자 입력 열 — 본 변수와 같은 글자를 받으므로 「상세 기재」를 붙여 가른다 */
const OPTION_TEXT_TYPES: ReadonlySet<SPSSExportColumn['type']> = new Set(['option-text', 'table-cell-option-text']);
const OPTION_TEXT_SUFFIX = '상세 기재';

/**
 * 변수 하나의 셀라벨 — 그 변수가 문항 안에서 무엇인지 말하는 짧은 이름.
 * Raw Data 2행 · 코딩북 셀라벨 · .sav 변수 라벨(「문항 제목 - 셀라벨」)이 모두 이 값을 쓴다.
 * 소비자마다 따로 만들면 한쪽만 비거나 겹친다(2026-10-30 코딩북·.sav 가 그랬다).
 * 우선순위: 표 칸·보기 엑셀라벨 > 보기·순위 분리 열 라벨 > 공백(변수 하나뿐인 문항).
 */
export function columnCellLabel(c: SPSSExportColumn): string {
  const label = baseLabel(c);
  if (!OPTION_TEXT_TYPES.has(c.type) || !label || label.endsWith(OPTION_TEXT_SUFFIX)) return label;
  return `${label} ${OPTION_TEXT_SUFFIX}`;
}

function baseLabel(c: SPSSExportColumn): string {
  if (c.cellExportLabel) return c.cellExportLabel;
  if (
    c.type === 'checkbox-item' ||
    c.type === 'choice-group' ||
    c.type === 'choice-group-item' ||
    c.type === 'ranking-rank' ||
    c.type === 'ranking-other' ||
    c.type === 'ranking-option-text' ||
    c.type === 'option-text' ||
    c.type === 'choice-table-cell' ||
    c.type === 'other-text' ||
    c.type === 'table-cell-option-text' ||
    c.type === 'table-cell-ranking-other' ||
    c.type === 'table-cell-ranking-option-text'
  ) {
    return c.optionLabel ?? '';
  }
  return '';
}

/** 셀라벨을 .sav 변수 라벨 앞에서 그대로 쓰는 열인가 — 엑셀라벨이 있거나 상세 기재 열 */
export function usesCellLabelForVariableLabel(c: SPSSExportColumn): boolean {
  return Boolean(c.cellExportLabel) || OPTION_TEXT_TYPES.has(c.type);
}
