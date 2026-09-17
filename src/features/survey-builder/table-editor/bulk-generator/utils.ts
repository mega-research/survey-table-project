import type { QuestionConditionGroup } from '@/types/survey';

import type { BulkItemDef } from './types';

export function padCode(num: number, maxNum: number): string {
  const digits = String(maxNum).length;
  return String(num).padStart(digits, '0');
}

export function buildDefs(
  baseLabel: string,
  baseCode: string,
  startNumber: number,
  count: number,
  condition: QuestionConditionGroup | undefined,
): BulkItemDef[] {
  if (!baseLabel.trim() || !baseCode.trim() || count <= 0) return [];

  const maxNum = startNumber + count - 1;
  const sanitizedLabel = baseLabel.trim();
  const sanitizedCode = baseCode.trim();

  return Array.from({ length: count }, (_, i) => {
    const num = startNumber + i;
    return {
      label: `${sanitizedLabel}${num}`,
      code: `${sanitizedCode}${padCode(num, maxNum)}`,
      displayCondition: condition
        ? JSON.parse(JSON.stringify(condition))
        : undefined,
    };
  });
}
