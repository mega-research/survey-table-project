import { describe, expect, it } from 'vitest';
import { collectNumericIssues } from '@/features/survey-response/lib/numeric-validation';
import type { Question } from '@/types/survey';

function validationTable(tolerance?: number): Question {
  return {
    id: 'q1', type: 'table', title: 'T', required: false, order: 1,
    tableRowsData: [{
      id: 'r1', label: 'r1',
      cells: [
        { id: 'a1', content: '', type: 'input', inputType: 'number' },
        { id: 'a2', content: '', type: 'input', inputType: 'number' },
        {
          id: 'total', content: '', type: 'input', inputType: 'number',
          formula: { kind: 'agg', fn: 'sum', items: [{ kind: 'cell', cellId: 'a1' }, { kind: 'cell', cellId: 'a2' }] },
          ...(tolerance !== undefined ? { formulaTolerance: tolerance } : {}),
        },
      ],
    }],
  } as Question;
}

const ctxOf = (q: Question, response: Record<string, unknown>) => ({
  allResponses: { [q.id]: response },
  allQuestions: [q],
  lookups: [],
  contactAttrs: {},
});

describe('formula 검증', () => {
  it('입력값이 계산값과 다르면 formula issue', () => {
    const q = validationTable();
    const response = { a1: '10', a2: '20', total: '99' };
    const issues = collectNumericIssues(q, response, ctxOf(q, response));
    const formula = issues.filter((i) => i.kind === 'formula');
    expect(formula).toHaveLength(1);
    expect(formula[0]!.cellIds).toEqual(['total']);
  });

  it('일치하면 무경고', () => {
    const q = validationTable();
    const response = { a1: '10', a2: '20', total: '30' };
    expect(collectNumericIssues(q, response, ctxOf(q, response)).filter((i) => i.kind === 'formula')).toEqual([]);
  });

  it('빈 입력은 수식 검증 스킵', () => {
    const q = validationTable();
    const response = { a1: '10', a2: '20' };
    expect(collectNumericIssues(q, response, ctxOf(q, response)).filter((i) => i.kind === 'formula')).toEqual([]);
  });

  it('tolerance 이내 오차는 통과', () => {
    const q = validationTable(1);
    const response = { a1: '10', a2: '20', total: '31' };
    expect(collectNumericIssues(q, response, ctxOf(q, response)).filter((i) => i.kind === 'formula')).toEqual([]);
  });

  it('수식이 null 로 평가되면 통과 (fail-safe)', () => {
    const q = validationTable();
    const totalCell = q.tableRowsData![0]!.cells[2]!;
    totalCell.formula = { kind: 'cell', cellId: 'total' }; // 순환
    const response = { total: '31' };
    expect(collectNumericIssues(q, response, ctxOf(q, response)).filter((i) => i.kind === 'formula')).toEqual([]);
  });

  it('ctx 에 lookups/contactAttrs 미주입이어도 크래시 없이 검증한다', () => {
    const q = validationTable();
    const response = { a1: '1', a2: '2', total: '9' };
    const issues = collectNumericIssues(q, response, { allResponses: { q1: response }, allQuestions: [q] });
    expect(issues.some((i) => i.kind === 'formula')).toBe(true);
  });
});
