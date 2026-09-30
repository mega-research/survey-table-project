import {
  isMobileTableDisplayMode,
  type MobileTableDisplayMode,
} from '@/types/mobile-table-display';

interface MobileTableDisplayInput {
  mobileTableDisplayMode?: unknown;
  mobileOriginalTable?: unknown;
}

export function resolveMobileTableDisplayMode(
  input: MobileTableDisplayInput,
): MobileTableDisplayMode {
  if (isMobileTableDisplayMode(input.mobileTableDisplayMode)) {
    return input.mobileTableDisplayMode;
  }
  if (input.mobileOriginalTable === true) return 'original';
  return 'auto';
}

/**
 * 「행별 원본 문항」의 시트 구조(행 제목·섹션 머리·앞쪽 열 제외·반복 헤더)를 쓰는 모드 — 행별 원본과
 * 행별 척도. 둘은 행 본문(원본 표 조각 / 척도 막대)만 다르다.
 */
export function isRowWiseMobileTableDisplayMode(mode: MobileTableDisplayMode): boolean {
  return mode === 'row-wise-original' || mode === 'row-wise-scale';
}

export function clampMobileDrilldownOmitLeadingColumns(
  value: unknown,
  authoredColumnCount: number,
): number {
  const max = Math.max(0, Math.trunc(authoredColumnCount) - 1);
  const candidate = typeof value === 'number' && Number.isFinite(value)
    ? Math.trunc(value)
    : 1;
  return Math.min(max, Math.max(0, candidate));
}
