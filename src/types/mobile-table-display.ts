export const MOBILE_TABLE_DISPLAY_MODES = [
  'auto',
  'drilldown-original-row',
  'original',
] as const;

export type MobileTableDisplayMode = (typeof MOBILE_TABLE_DISPLAY_MODES)[number];

export function isMobileTableDisplayMode(value: unknown): value is MobileTableDisplayMode {
  return typeof value === 'string'
    && (MOBILE_TABLE_DISPLAY_MODES as readonly string[]).includes(value);
}
