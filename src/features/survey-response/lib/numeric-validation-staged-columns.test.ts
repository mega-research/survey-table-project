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

describe('열 차례로 열기 — 닫힌 열은 모든 차단 검증에서 빠진다', () => {
  // 1단계 입력 a, 2단계 계산 칸 k = a, 검증 k == 100. 2단계가 닫혀 있으면 k 는 화면에 없다 —
  // 보이지 않는 칸의 오류가 「다음」을 막으면 응답자는 풀 길이 없다.
  const calcQ = {
    ...q,
    tableColumns: [
      { id: 'c1', label: '원유' },
      { id: 'c2', label: '기타2 계산', revealStep: 2 },
      { id: 'c3', label: '기타2 원료명', revealStep: 2 },
    ],
    tableRowsData: [
      {
        id: 'r1',
        label: '국내산',
        cells: [
          { id: 'a', type: 'input', content: '', inputType: 'number' },
          {
            id: 'k',
            type: 'calc',
            content: '',
            formula: { kind: 'cell', cellId: 'a' },
            calcValidation: { operator: 'eq', target: { kind: 'literal', value: 100 } },
          },
          { id: 'n', type: 'input', content: '' },
        ],
      },
    ],
  } as unknown as Question;
  // 계산 칸 검증은 ctx 가 있어야 돈다(없으면 fail-safe 통과)
  const run = (values: Record<string, unknown>) =>
    collectNumericIssues(calcQ, values, {
      allResponses: { q1: values },
      allQuestions: [calcQ],
      contactAttrs: {},
    });

  it('닫힌 단계의 계산 칸 검증은 막지 않는다', () => {
    expect(run({ a: '1' })).toEqual([]);
  });

  it('저장 경계가 넣은 계산 칸 값으로 단계가 열리지 않는다', () => {
    expect(run({ a: '1', k: '1' })).toEqual([]);
  });

  it('응답 칸에 값이 들어와 열린 단계의 계산 칸은 검사한다', () => {
    expect(run({ a: '1', n: '연유' }).map((i) => i.kind)).toContain('formula');
  });
});
