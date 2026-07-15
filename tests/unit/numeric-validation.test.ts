import { describe, expect, it } from 'vitest';

import {
  collectNumericIssues,
  evaluateSumConstraint,
  pruneSumConstraints,
} from '@/lib/survey/numeric-validation';
import type { Question, SumConstraint, TableRow } from '@/types/survey';

/** 숫자 input 셀 2개(c1, c2)를 가진 최소 테이블 질문 픽스처 */
function tableQuestion(overrides: Partial<Question> = {}): Question {
  const rows: TableRow[] = [
    {
      id: 'r1',
      cells: [
        { id: 'c1', type: 'input', content: '', inputType: 'number' },
        { id: 'c2', type: 'input', content: '', inputType: 'number' },
      ],
    },
  ] as TableRow[];
  return {
    id: 'q1',
    type: 'table',
    title: '표',
    required: false,
    order: 0,
    tableRowsData: rows,
    ...overrides,
  } as Question;
}

const eq100: SumConstraint = { id: 's1', cellIds: ['c1', 'c2'], operator: 'eq', target: 100 };

describe('evaluateSumConstraint', () => {
  const ids = new Set(['c1', 'c2']);

  it('eq: 합이 목표와 같아야 ok', () => {
    expect(evaluateSumConstraint(eq100, { c1: '60', c2: '40' }, ids)).toMatchObject({
      ok: true,
      sum: 100,
    });
    expect(evaluateSumConstraint(eq100, { c1: '60', c2: '30' }, ids)).toMatchObject({
      ok: false,
      sum: 90,
    });
  });

  it('lte/gte 연산자', () => {
    const lte = { ...eq100, operator: 'lte' as const };
    const gte = { ...eq100, operator: 'gte' as const };
    expect(evaluateSumConstraint(lte, { c1: '60', c2: '30' }, ids).ok).toBe(true);
    expect(evaluateSumConstraint(lte, { c1: '60', c2: '50' }, ids).ok).toBe(false);
    expect(evaluateSumConstraint(gte, { c1: '60', c2: '50' }, ids).ok).toBe(true);
    expect(evaluateSumConstraint(gte, { c1: '30', c2: '20' }, ids)).toMatchObject({
      ok: false,
      sum: 50,
    });
  });

  it('빈 셀은 0으로 간주하고, 전부 빈 값이면 skipped', () => {
    expect(evaluateSumConstraint(eq100, { c1: '100', c2: '' }, ids)).toMatchObject({
      ok: true,
      sum: 100,
    });
    expect(evaluateSumConstraint(eq100, {}, ids).skipped).toBe(true);
    expect(evaluateSumConstraint(eq100, { c1: '', c2: '' }, ids).skipped).toBe(true);
  });

  it('부동소수 오차: 33.3+33.3+33.4 = 100', () => {
    const c: SumConstraint = { id: 's2', cellIds: ['c1', 'c2', 'c3'], operator: 'eq', target: 100 };
    const r = evaluateSumConstraint(c, { c1: '33.3', c2: '33.3', c3: '33.4' }, new Set(['c1', 'c2', 'c3']));
    expect(r.ok).toBe(true);
  });

  it('존재하지 않는 cellId 는 무시하고, 유효 셀이 0개면 skipped', () => {
    const dangling: SumConstraint = { id: 's3', cellIds: ['ghost'], operator: 'eq', target: 100 };
    expect(evaluateSumConstraint(dangling, { c1: '50' }, ids).skipped).toBe(true);
  });
});

describe('collectNumericIssues — 단답형 범위', () => {
  const textQ = {
    id: 'q2',
    type: 'text',
    title: '단답',
    required: false,
    order: 0,
    inputType: 'number',
    numberFormat: { min: 10, max: 100 },
  } as Question;

  it('min 미달이면 issue, 충족·빈 값이면 없음', () => {
    expect(collectNumericIssues(textQ, '5')).toHaveLength(1);
    expect(collectNumericIssues(textQ, '5')[0]).toMatchObject({ kind: 'range' });
    expect(collectNumericIssues(textQ, '10')).toHaveLength(0);
    expect(collectNumericIssues(textQ, '')).toHaveLength(0);
    expect(collectNumericIssues(textQ, undefined)).toHaveLength(0);
  });

  it('max 초과도 issue — 타이핑 차단을 우회한 값(prefill·레거시) 봉합', () => {
    expect(collectNumericIssues(textQ, '500')).toHaveLength(1);
    expect(collectNumericIssues(textQ, '500')[0]!.message).toContain('이하');
    expect(collectNumericIssues(textQ, '100')).toHaveLength(0);
  });
});

describe('collectNumericIssues — 테이블', () => {
  it('합계 위반 issue 에 현재 합계와 대상 셀이 담긴다', () => {
    const q = tableQuestion({ sumConstraints: [eq100] });
    const issues = collectNumericIssues(q, { c1: '60', c2: '30' });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'sum', cellIds: ['c1', 'c2'] });
    expect(issues[0]!.message).toContain('90');
    expect(issues[0]!.message).toContain('100');
  });

  it('errorMessage 지정 시 그 메시지를 사용한다', () => {
    const q = tableQuestion({
      sumConstraints: [{ ...eq100, errorMessage: '비중 합은 100이어야 합니다' }],
    });
    const issues = collectNumericIssues(q, { c1: '60', c2: '30' });
    expect(issues[0]!.message).toContain('비중 합은 100이어야 합니다');
  });

  it('테이블 미접촉이면 합계·필수 셀 검증을 스킵한다', () => {
    const rows: TableRow[] = [
      {
        id: 'r1',
        cells: [
          { id: 'c1', type: 'input', content: '', inputType: 'number', required: true },
          { id: 'c2', type: 'input', content: '', inputType: 'number' },
        ],
      },
    ] as TableRow[];
    const q = tableQuestion({ tableRowsData: rows, sumConstraints: [eq100] });
    expect(collectNumericIssues(q, undefined)).toHaveLength(0);
    expect(collectNumericIssues(q, {})).toHaveLength(0);
  });

  it('셀 하나라도 입력되면 필수 셀 위반을 잡는다', () => {
    const rows: TableRow[] = [
      {
        id: 'r1',
        cells: [
          { id: 'c1', type: 'input', content: '', inputType: 'number', required: true },
          { id: 'c2', type: 'input', content: '', inputType: 'number' },
        ],
      },
    ] as TableRow[];
    const q = tableQuestion({ tableRowsData: rows });
    const issues = collectNumericIssues(q, { c2: '5' });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'required-cells', cellIds: ['c1'] });
    expect(collectNumericIssues(q, { c1: '3', c2: '5' })).toHaveLength(0);
  });

  it('사이드카 키만 있는 응답은 미접촉으로 스킵한다', () => {
    const rows: TableRow[] = [
      {
        id: 'r1',
        cells: [
          { id: 'c1', type: 'input', content: '', inputType: 'number', required: true },
          { id: 'c2', type: 'input', content: '', inputType: 'number' },
        ],
      },
    ] as TableRow[];
    const q = tableQuestion({ tableRowsData: rows, sumConstraints: [eq100] });
    // 동적 행만 선택하고 값은 미입력 — __selectedRowIds 는 셀 값이 아니다
    expect(collectNumericIssues(q, { __selectedRowIds: ['r1'] })).toHaveLength(0);
  });

  it('미선택 동적 행의 필수 셀은 평가에서 제외한다', () => {
    const rows: TableRow[] = [
      {
        id: 'r1',
        cells: [{ id: 'c1', type: 'input', content: '', inputType: 'number' }],
      },
      {
        id: 'r2',
        dynamicGroupId: 'g1',
        cells: [{ id: 'c2', type: 'input', content: '', inputType: 'number', required: true }],
      },
    ] as TableRow[];
    const q = tableQuestion({
      tableRowsData: rows,
      dynamicRowConfigs: [{ groupId: 'g1', enabled: true }],
    } as Partial<Question>);
    // r2 미선택 — c2 는 렌더되지 않으므로 필수 평가 제외
    expect(collectNumericIssues(q, { c1: '5' })).toHaveLength(0);
    // r2 선택 — c2 가 표시되므로 필수 발동
    const issues = collectNumericIssues(q, { c1: '5', __selectedRowIds: ['r2'] });
    expect(issues[0]).toMatchObject({ kind: 'required-cells', cellIds: ['c2'] });
  });

  it('미선택 동적 행에 잔존한 셀 값은 합계에서 제외한다 (선택되면 포함)', () => {
    const rows: TableRow[] = [
      {
        id: 'r1',
        cells: [{ id: 'c1', type: 'input', content: '', inputType: 'number' }],
      },
      {
        id: 'r2',
        dynamicGroupId: 'g1',
        cells: [{ id: 'c2', type: 'input', content: '', inputType: 'number' }],
      },
    ] as TableRow[];
    const q = tableQuestion({
      tableRowsData: rows,
      dynamicRowConfigs: [{ groupId: 'g1', enabled: true }],
      sumConstraints: [eq100],
    } as Partial<Question>);
    // r2 미선택 — c2 에 값(30)이 잔존해도(선택 해제 시 use-dynamic-row-state 가 값을 지우지 않음)
    // 합계 평가에서 제외돼 c1(100) 단독으로 eq 100 을 충족한다.
    expect(collectNumericIssues(q, { c1: '100', c2: '30' })).toHaveLength(0);
    // r2 선택 — c2 가 화면에 표시되므로 합산에 포함되어 100+30=130 ≠ 100 위반.
    const issues = collectNumericIssues(q, {
      c1: '100',
      c2: '30',
      __selectedRowIds: ['r2'],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'sum', cellIds: ['c1', 'c2'] });
  });

  it('isHidden 셀은 합계에서도 제외한다', () => {
    const rows: TableRow[] = [
      {
        id: 'r1',
        cells: [
          { id: 'c1', type: 'input', content: '', inputType: 'number' },
          { id: 'c2', type: 'input', content: '', inputType: 'number', isHidden: true },
        ],
      },
    ] as TableRow[];
    const q = tableQuestion({ tableRowsData: rows, sumConstraints: [eq100] });
    // c2 는 isHidden — 값이 남아 있어도 합산 대상에서 제외돼 c1(100) 단독으로 eq 100 충족.
    expect(collectNumericIssues(q, { c1: '100', c2: '30' })).toHaveLength(0);
  });

  it('isHidden 필수 셀은 평가에서 제외한다', () => {
    const rows: TableRow[] = [
      {
        id: 'r1',
        cells: [
          { id: 'c1', type: 'input', content: '', inputType: 'number' },
          { id: 'c2', type: 'input', content: '', inputType: 'number', required: true, isHidden: true },
        ],
      },
    ] as TableRow[];
    const q = tableQuestion({ tableRowsData: rows });
    expect(collectNumericIssues(q, { c1: '5' })).toHaveLength(0);
  });

  it('셀 범위 위반(min 미달·max 초과)을 잡는다', () => {
    const rows: TableRow[] = [
      {
        id: 'r1',
        cells: [
          {
            id: 'c1',
            type: 'input',
            content: '',
            inputType: 'number',
            numberFormat: { min: 10, max: 100 },
          },
        ],
      },
    ] as TableRow[];
    const q = tableQuestion({ tableRowsData: rows });
    expect(collectNumericIssues(q, { c1: '5' })[0]).toMatchObject({ kind: 'range', cellIds: ['c1'] });
    expect(collectNumericIssues(q, { c1: '500' })[0]).toMatchObject({ kind: 'range', cellIds: ['c1'] });
    expect(collectNumericIssues(q, { c1: '10' })).toHaveLength(0);
    expect(collectNumericIssues(q, { c1: '' })).toHaveLength(0);
  });
});

describe('pruneSumConstraints', () => {
  it('존재하지 않는 cellId 를 제거한다', () => {
    const rows = tableQuestion().tableRowsData!;
    const pruned = pruneSumConstraints([{ ...eq100, cellIds: ['c1', 'ghost'] }], rows);
    expect(pruned[0]!.cellIds).toEqual(['c1']);
  });
});
