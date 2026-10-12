import { describe, expect, it } from 'vitest';

import type { Question } from '@/types/survey';

import { collectNumericIssues, fillMessageValues } from './numeric-validation';

describe('fillMessageValues — 저작자 문구의 숫자 자리표시자', () => {
  it('자리표시자를 실제 숫자로 바꾼다 (천 단위 구분)', () => {
    expect(
      fillMessageValues('Q22는 {기준값}명인데 합계는 {현재값}명입니다.', {
        current: 4,
        target: 1234,
      }),
    ).toBe('Q22는 1,234명인데 합계는 4명입니다.');
  });

  it('자리표시자가 없으면 문구는 그대로다', () => {
    expect(fillMessageValues('합이 맞지 않습니다.', { current: 4, target: 7 })).toBe(
      '합이 맞지 않습니다.',
    );
  });

  it('값을 못 구한 자리표시자는 남겨 둔다', () => {
    expect(fillMessageValues('{현재값} / {기준값}', { current: 4 })).toBe('4 / {기준값}');
  });
});

describe('collectNumericIssues — 문구에 실제 값이 실린다', () => {
  const table = (extra: Partial<Question>): Question =>
    ({
      id: 'q1',
      type: 'table',
      title: 't',
      required: false,
      order: 0,
      tableColumns: [{ id: 'c1', label: 'a' }],
      tableRowsData: [
        {
          id: 'r1',
          label: 'r1',
          cells: [
            { id: 'a', type: 'input', inputType: 'number', content: '' },
            { id: 'b', type: 'input', inputType: 'number', content: '' },
            {
              id: 'total',
              type: 'calc',
              content: '',
              formula: {
                kind: 'group',
                op: '+',
                terms: [
                  { kind: 'cell', cellId: 'a' },
                  { kind: 'cell', cellId: 'b' },
                ],
              },
              calcValidation: {
                operator: 'eq',
                target: { kind: 'question', questionId: 'src' },
                errorMessage: '앞에서는 {기준값}명인데 합계는 {현재값}명입니다.',
              },
            },
          ],
        },
      ],
      ...extra,
    }) as unknown as Question;
  const src = { id: 'src', type: 'text', inputType: 'number', title: 's', order: 0 } as Question;

  it('계산 칸 검증 문구', () => {
    const q = table({});
    const responses = { q1: { a: '3', b: '1' }, src: '7' };
    const issues = collectNumericIssues(q, responses.q1, {
      allResponses: responses,
      allQuestions: [src, q],
    });
    expect(issues.map((i) => i.message)).toEqual(['앞에서는 7명인데 합계는 4명입니다.']);
  });

  it('합계 제약 문구', () => {
    const q = table({
      sumConstraints: [
        {
          id: 's1',
          cellIds: ['a', 'b'],
          operator: 'eq',
          target: 100,
          errorMessage: '합이 {기준값}이어야 합니다 (지금 {현재값}).',
        },
      ],
    });
    const responses = { q1: { a: '60', b: '30' } };
    const issues = collectNumericIssues(q, responses.q1, {
      allResponses: responses,
      allQuestions: [q],
    });
    expect(issues.map((i) => i.message)).toContain('합이 100이어야 합니다 (지금 90).');
  });
});
