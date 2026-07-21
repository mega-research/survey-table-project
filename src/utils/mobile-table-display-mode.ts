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
