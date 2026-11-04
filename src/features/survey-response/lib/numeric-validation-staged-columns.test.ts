import { describe, expect, it } from 'vitest';

import { collectNumericIssues } from '@/features/survey-response/lib/numeric-validation';
import type { Question } from '@/types/survey';

/**
 * 열 차례로 열기 — 아직 열지 않은 단계의 열 칸은 필수에서 빠진다(화면에 없는 칸이 「다음」을
 * 막으면 안 된다). 값이 들어와 열린 단계의 칸은 평범한 칸으로 검사한다.
 */
const q = {
  id: 'q1',
  type: 'table',
  title: '표',
  required: false,
  order: 0,
  tableColumns: [
    { id: 'c1', label: '원유' },
    { id: 'c2', label: '기타2 원료명', revealStep: 2 },
    { id: 'c3', label: '기타2 투입량', revealStep: 2 },
  ],
  tableRowsData: [
    {
      id: 'r1',
      label: '국내산',
      cells: [
        { id: 'a', type: 'input', content: '' },
        { id: 'b', type: 'input', content: '', required: true },
        { id: 'c', type: 'input', content: '', required: true },
      ],
    },
  ],
} as Question;

describe('열 차례로 열기 — 필수 범위', () => {
  it('열지 않은 단계의 필수 칸은 막지 않는다', () => {
    expect(collectNumericIssues(q, { a: '1' }, undefined)).toEqual([]);
  });

  it('값이 들어와 열린 단계의 필수 칸은 막는다', () => {
    const issues = collectNumericIssues(q, { a: '1', b: '연유' }, undefined);
    expect(issues.map((i) => i.kind)).toContain('required-cells');
  });
});
