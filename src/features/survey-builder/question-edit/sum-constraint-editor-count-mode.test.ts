import { describe, expect, it } from 'vitest';

import {
  leftModeOf,
  switchLeftMode,
} from '@/features/survey-builder/question-edit/sum-constraint-editor';
import type { SumConstraint } from '@/types/survey';

const numeric = new Set(['n1', 'n2']);
const sum: SumConstraint = { id: 's', cellIds: ['n1', 'n2'], operator: 'eq', target: 100 };

describe('합계 제약 좌변 모드 전환', () => {
  it('모드는 수식 > 집계 방식 순으로 파생한다', () => {
    expect(leftModeOf(sum)).toBe('cells');
    expect(leftModeOf({ ...sum, aggregate: 'count' })).toBe('count');
    expect(leftModeOf({ ...sum, aggregate: 'count', leftExpr: { kind: 'literal', value: 1 } })).toBe('expr');
  });

  it('합계 → 입력된 칸 수: 기본값(정확히 100)을 "1 이상" 으로 바꾸고 참조·오차를 걷어낸다', () => {
    const next = switchLeftMode(
      { ...sum, tolerance: 0.5, targetExpr: { kind: 'literal', value: 3 } },
      'count',
      numeric,
    );
    expect(next).toEqual({ id: 's', cellIds: ['n1', 'n2'], aggregate: 'count', operator: 'gte', target: 1 });
  });

  it('합계 → 입력된 칸 수: 사람이 고친 기준값과 연산자는 보존한다', () => {
    const next = switchLeftMode({ ...sum, operator: 'lte', target: 3 }, 'count', numeric);
    expect(next).toMatchObject({ aggregate: 'count', operator: 'lte', target: 3 });
  });

  it('입력된 칸 수 → 합계: 숫자 칸이 아닌 선택을 뺀다', () => {
    const count: SumConstraint = { id: 'k', aggregate: 'count', cellIds: ['n1', 'radio1'], operator: 'gte', target: 1 };
    const next = switchLeftMode(count, 'cells', numeric);
    expect(next).toEqual({ id: 'k', cellIds: ['n1'], operator: 'gte', target: 1 });
  });

  it('입력된 칸 수 → 수식: 숫자 칸만 SUM 수식으로 시드한다', () => {
    const count: SumConstraint = { id: 'k', aggregate: 'count', cellIds: ['n1', 'radio1'], operator: 'gte', target: 1 };
    const next = switchLeftMode(count, 'expr', numeric);
    expect(next.aggregate).toBeUndefined();
    expect(next.leftExpr).toEqual({
      kind: 'group',
      op: '+',
      terms: [{ kind: 'agg', fn: 'sum', items: [{ kind: 'cell', cellId: 'n1' }] }],
    });
  });

  it('같은 모드로의 전환은 원본 참조를 돌려준다', () => {
    expect(switchLeftMode(sum, 'cells', numeric)).toBe(sum);
  });
});
