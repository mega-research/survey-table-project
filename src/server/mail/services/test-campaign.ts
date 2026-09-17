export function withTestPrefix(value: string, isTest: boolean): string {
  if (!isTest) return value;
  const normalized = value.trim().replace(/^(?:\[TEST\]\s*)+/, '');
  return `[TEST] ${normalized}`;
}
