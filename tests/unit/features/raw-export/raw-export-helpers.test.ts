import { describe, expect, it } from 'vitest';

import { formatExcelDateTime, buildCodebookValueLabel } from '@/lib/analytics/raw-export-helpers';
import type { SPSSExportColumn } from '@/lib/analytics/spss-excel-export';
import type { Question } from '@/types/survey';

describe('formatExcelDateTime', () => {
  it('KST YYYY-MM-DD HH:mm 으로 포맷한다', () => {
    // 2026-06-03T05:30:00Z = KST 14:30
    expect(formatExcelDateTime(new Date('2026-06-03T05:30:00Z'))).toBe('2026-06-03 14:30');
  });
  it('null 은 빈 문자열', () => {
    expect(formatExcelDateTime(null)).toBe('');
  });
});

describe('buildCodebookValueLabel', () => {
  const radioQ = {
    id: 'q1', type: 'radio', title: 'Q1', questionCode: 'Q1',
    options: [
      { id: 'a', label: '남성', value: 'opt1', spssNumericCode: 1 },
      { id: 'b', label: '여성', value: 'opt2', spssNumericCode: 2 },
    ],
  } as unknown as Question;
  const qMap = new Map<string, Question>([['q1', radioQ]]);

  it('단일선택은 code=label 나열', () => {
    const col = { type: 'single', questionId: 'q1', spssVarName: 'Q1' } as SPSSExportColumn;
    expect(buildCodebookValueLabel(col, qMap)).toBe('1=남성, 2=여성');
  });

  it('checkbox 항목은 빈값=비선택, code=선택', () => {
    const col = {
      type: 'checkbox-item', questionId: 'q1', spssVarName: 'Q1_1',
      optionIndex: 0,
    } as SPSSExportColumn;
    const cbQ = {
      id: 'q1', type: 'checkbox', title: 'Q1', questionCode: 'Q1',
      options: [{ id: 'a', label: 'AI', value: 'opt1', spssNumericCode: 1 }],
    } as unknown as Question;
    expect(buildCodebookValueLabel(col, new Map([['q1', cbQ]]))).toBe('빈값=비선택, 1=선택');
  });

  it('텍스트는 빈 문자열', () => {
    const col = { type: 'text', questionId: 'q1', spssVarName: 'Q1' } as SPSSExportColumn;
    expect(buildCodebookValueLabel(col, qMap)).toBe('');
  });
});
