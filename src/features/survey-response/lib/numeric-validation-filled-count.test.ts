import { describe, expect, it } from 'vitest';

import {
  collectNumericIssues,
  evaluateFilledCountConstraint,
} from '@/features/survey-response/lib/numeric-validation';
import type { Question, SumConstraint, TableCell, TableRow } from '@/types/survey';

/**
 * 합계 제약의 「입력된 칸 수」 모드 — "이 칸들 중 N칸 이상 입력" (CONTEXT.md "입력된 칸 수").
 * 합계 모드와 달리 **대상 칸이 전부 비어도, 표를 건드리지 않았어도** 검사한다 — "하나는
 * 적어야 한다" 가 이 모드의 존재 이유라서다.
 */
const cell = (id: string, over: Partial<TableCell> = {}): TableCell =>
  ({ id, type: 'input', content: '', inputType: 'number', ...over }) as TableCell;

function question(cells: TableCell[], constraint: SumConstraint, over: Partial<Question> = {}) {
  return {
    id: 'q1',
    type: 'table',
    title: '표',
    required: false,
    order: 0,
    tableRowsData: cells.map((c, i) => ({ id: `r${i}`, label: '', cells: [c] })) as TableRow[],
    sumConstraints: [constraint],
    ...over,
  } as Question;
}

const atLeastOne: SumConstraint = {
  id: 'k1',
  aggregate: 'count',
  cellIds: ['a', 'b', 'c'],
  operator: 'gte',
  target: 1,
};
const all = new Set(['a', 'b', 'c']);

describe('evaluateFilledCountConstraint', () => {
  it('입력된 칸 수를 세어 비교한다 — 숫자 0 도 입력이다', () => {
    expect(evaluateFilledCountConstraint(atLeastOne, { b: '0' }, all)).toEqual({
      skipped: false,
      ok: true,
      count: 1,
      filledIds: ['b'],
      emptyIds: ['a', 'c'],
    });
  });

  it('전부 비어도 건너뛰지 않는다 — 공백만 있는 칸·빈 배열은 미입력', () => {
    const r = evaluateFilledCountConstraint(atLeastOne, { a: '  ', b: '', c: [] }, all);
    expect(r).toMatchObject({ skipped: false, ok: false, count: 0 });
  });

  it('선택형 응답도 입력으로 센다 — 라디오 값, 체크박스 배열', () => {
    const r = evaluateFilledCountConstraint(atLeastOne, { a: { optionId: 'o1' }, b: ['x'] }, all);
    expect(r).toMatchObject({ ok: true, count: 2 });
  });

  it('화면에 없는(보이지 않거나 비활성인) 칸은 세지 않고, 대상이 하나도 안 보이면 건너뛴다', () => {
    expect(evaluateFilledCountConstraint(atLeastOne, { a: '5' }, new Set(['b', 'c']))).toMatchObject({
      skipped: false,
      ok: false,
      count: 0,
    });
    expect(evaluateFilledCountConstraint(atLeastOne, { a: '5' }, new Set())).toMatchObject({
      skipped: true,
      ok: true,
    });
  });

  it('연산자 전부 — 정확히 2칸, 최대 1칸', () => {
    const exactly2: SumConstraint = { ...atLeastOne, operator: 'eq', target: 2 };
    expect(evaluateFilledCountConstraint(exactly2, { a: '1', b: '2' }, all).ok).toBe(true);
    expect(evaluateFilledCountConstraint(exactly2, { a: '1' }, all).ok).toBe(false);
    const atMost1: SumConstraint = { ...atLeastOne, operator: 'lte', target: 1 };
    expect(evaluateFilledCountConstraint(atMost1, {}, all).ok).toBe(true);
    expect(evaluateFilledCountConstraint(atMost1, { a: '1', c: '3' }, all).ok).toBe(false);
  });
});

describe('collectNumericIssues — 입력된 칸 수', () => {
  const q = question([cell('a'), cell('b'), cell('c')], atLeastOne);

  it('건드리지 않은 표도 막는다 (합계 모드는 미접촉이면 건너뛴다)', () => {
    for (const response of [undefined, {}]) {
      const issues = collectNumericIssues(q, response);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ kind: 'sum', cellIds: ['a', 'b', 'c'] });
      expect(issues[0]!.message).toBe('선택된 칸 중 1칸 이상 입력해야 합니다 (현재 0칸)');
    }
  });

  it('하나만 채우면 통과하고, 썼다 지운 칸은 입력으로 치지 않는다', () => {
    expect(collectNumericIssues(q, { b: '5' })).toHaveLength(0);
    expect(collectNumericIssues(q, { b: '' })).toHaveLength(1);
  });

  it('errorMessage 를 주면 그대로 쓴다', () => {
    const custom = question([cell('a'), cell('b'), cell('c')], {
      ...atLeastOne,
      errorMessage: 'GPU 를 한 종류 이상 적어 주세요',
    });
    expect(collectNumericIssues(custom, {})[0]!.message).toBe('GPU 를 한 종류 이상 적어 주세요');
  });

  it('너무 많이 채웠으면 채운 칸을 짚는다', () => {
    const atMost1 = question([cell('a'), cell('b'), cell('c')], {
      ...atLeastOne,
      operator: 'lte',
      target: 1,
    });
    const issues = collectNumericIssues(atMost1, { a: '1', c: '2' });
    expect(issues[0]).toMatchObject({ kind: 'sum', cellIds: ['a', 'c'] });
    expect(issues[0]!.message).toBe('선택된 칸 중 1칸까지만 입력할 수 있습니다 (현재 2칸)');
  });

  it('비활성 게이팅 칸은 대상에서 빠진다 — 남은 대상이 없으면 막지 않는다', () => {
    const gated = question(
      [cell('ctl'), cell('a', { enabledWhen: { kind: 'filled', controllerCellId: 'ctl' } })],
      { ...atLeastOne, cellIds: ['a'] },
    );
    expect(collectNumericIssues(gated, {})).toHaveLength(0);
    expect(collectNumericIssues(gated, { ctl: '1' })).toHaveLength(1);
    expect(collectNumericIssues(gated, { ctl: '1', a: '3' })).toHaveLength(0);
  });

  it('병합으로 숨은 칸은 대상에서 빠진다', () => {
    const hidden = question([cell('a', { isHidden: true }), cell('b')], {
      ...atLeastOne,
      cellIds: ['a', 'b'],
    });
    const issues = collectNumericIssues(hidden, { a: '9' });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.cellIds).toEqual(['b']);
  });

  it('칸 수 규칙은 합계로 평가되지 않는다 — 값의 합이 기준과 달라도 무관', () => {
    expect(collectNumericIssues(q, { a: '50', b: '70' })).toHaveLength(0);
  });

  it('합계 규칙과 나란히 둘 수 있다', () => {
    const both = question([cell('a'), cell('b'), cell('c')], atLeastOne, {
      sumConstraints: [
        atLeastOne,
        { id: 's', cellIds: ['a', 'b', 'c'], operator: 'eq', target: 100 },
      ],
    });
    expect(collectNumericIssues(both, { a: '60' }).map((i) => i.message)).toEqual([
      '선택된 셀 합계가 100이 되어야 합니다 (현재 60)',
    ]);
    expect(collectNumericIssues(both, {})).toHaveLength(1);
  });
});
