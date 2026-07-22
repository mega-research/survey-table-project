export function withTestPrefix(value: string, isTest: boolean): string {
  const trimmed = value.trim();
  if (!isTest || trimmed.startsWith('[TEST] ')) return trimmed;
  return `[TEST] ${trimmed}`;
}
