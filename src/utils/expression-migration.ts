import type {
  ExpressionConditionConfig,
  ExpressionOperand,
  LeftOperand,
  NumericComparison,
  RightOperand,
} from '@/types/survey';

function convertLegacyLeftCell(c: { kind: 'cell'; questionId: string; cellId: string }): ExpressionOperand {
  return { kind: 'cell', questionId: c.questionId, cellId: c.cellId };
}

function convertLegacyLeft(
  left: LeftOperand,
  _outerCellRef: { questionId: string; cellId: string },
): ExpressionOperand {
  if (left.kind === 'cell') {
    return { kind: 'cell', questionId: left.questionId, cellId: left.cellId };
  }
  // binop
  return {
    kind: 'binop',
    op: left.op,
    left: convertLegacyLeftCell(left.left),
    right:
      left.right.kind === 'literal'
        ? { kind: 'literal', value: left.right.value }
        : convertLegacyLeftCell(left.right),
  };
}

function convertLegacyRight(right: RightOperand): ExpressionOperand {
  if (right.kind === 'literal') return { kind: 'literal', value: right.value };
  return {
    kind: 'lookup',
    surveyLookupId: right.surveyLookupId,
    keyMapping: right.keyMapping,
    valueColumn: right.valueColumn,
  };
}

export function migrateNumericComparisonToExpression(
  nc: NumericComparison,
  outerCellRef: { questionId: string; cellId: string },
): ExpressionConditionConfig {
  const left: ExpressionOperand = nc.left
    ? convertLegacyLeft(nc.left, outerCellRef)
    : { kind: 'cell', questionId: outerCellRef.questionId, cellId: outerCellRef.cellId };

  const right: ExpressionOperand = nc.right
    ? convertLegacyRight(nc.right)
    : nc.comparand
      ? { kind: 'literal', value: nc.comparand.value }
      : { kind: 'literal', value: 0 };

  return {
    clauses: [
      {
        kind: 'comparison',
        comparison: { left, op: nc.operator, right },
      },
    ],
    joinOps: [],
  };
}
