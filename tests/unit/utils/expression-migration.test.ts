import { describe, it, expect } from 'vitest';
import type { NumericComparison } from '@/types/survey';
import { migrateNumericComparisonToExpression } from '@/utils/expression-migration';

const OUTER_CELL = { questionId: 'q1', cellId: 'cell-a' };

describe('migrateNumericComparisonToExpression', () => {
  it('legacy comparand (literal) → expression literal', () => {
    const nc: NumericComparison = {
      operator: '<=',
      comparand: { kind: 'literal', value: 100 },
    };
    const result = migrateNumericComparisonToExpression(nc, OUTER_CELL);
    expect(result.clauses).toHaveLength(1);
    expect(result.clauses[0]).toEqual({
      kind: 'comparison',
      comparison: {
        left: { kind: 'cell', ...OUTER_CELL },
        op: '<=',
        right: { kind: 'literal', value: 100 },
      },
    });
  });

  it('legacy right.literal (new style) → expression literal', () => {
    const nc: NumericComparison = {
      operator: '==',
      right: { kind: 'literal', value: 5 },
    };
    const result = migrateNumericComparisonToExpression(nc, OUTER_CELL);
    expect(result.clauses[0]).toMatchObject({
      kind: 'comparison',
      comparison: { right: { kind: 'literal', value: 5 } },
    });
  });

  it('legacy right.lookup → expression lookup', () => {
    const nc: NumericComparison = {
      operator: '<=',
      right: {
        kind: 'lookup',
        surveyLookupId: 'lut1',
        keyMapping: [{ lutKey: '대륙', attrsKey: '대륙' }],
        valueColumn: '평균',
      },
    };
    const result = migrateNumericComparisonToExpression(nc, OUTER_CELL);
    expect(result.clauses[0]).toMatchObject({
      kind: 'comparison',
      comparison: { right: { kind: 'lookup', surveyLookupId: 'lut1' } },
    });
  });

  it('legacy left.cell → expression cell', () => {
    const nc: NumericComparison = {
      operator: '>',
      left: { kind: 'cell', questionId: 'q2', cellId: 'cell-x' },
      right: { kind: 'literal', value: 0 },
    };
    const result = migrateNumericComparisonToExpression(nc, OUTER_CELL);
    expect(result.clauses[0].kind).toBe('comparison');
    if (result.clauses[0].kind === 'comparison') {
      expect(result.clauses[0].comparison.left).toEqual({
        kind: 'cell', questionId: 'q2', cellId: 'cell-x',
      });
    }
  });

  it('legacy left.binop → expression binop', () => {
    const nc: NumericComparison = {
      operator: '<=',
      left: {
        kind: 'binop',
        op: '/',
        left:  { kind: 'cell', questionId: 'q1', cellId: 'a' },
        right: { kind: 'cell', questionId: 'q1', cellId: 'b' },
      },
      right: { kind: 'literal', value: 100 },
    };
    const result = migrateNumericComparisonToExpression(nc, OUTER_CELL);
    if (result.clauses[0].kind === 'comparison') {
      expect(result.clauses[0].comparison.left).toEqual({
        kind: 'binop',
        op: '/',
        left:  { kind: 'cell', questionId: 'q1', cellId: 'a' },
        right: { kind: 'cell', questionId: 'q1', cellId: 'b' },
      });
    }
  });

  it('left 없음 + comparand 만 → outer cell + literal', () => {
    const nc: NumericComparison = {
      operator: '>',
      comparand: { kind: 'literal', value: 0 },
    };
    const result = migrateNumericComparisonToExpression(nc, OUTER_CELL);
    if (result.clauses[0].kind === 'comparison') {
      expect(result.clauses[0].comparison.left).toEqual({
        kind: 'cell', ...OUTER_CELL,
      });
      expect(result.clauses[0].comparison.right).toEqual({
        kind: 'literal', value: 0,
      });
    }
  });
});
