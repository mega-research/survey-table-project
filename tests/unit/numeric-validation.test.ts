import { describe, expect, it } from 'vitest';

import {
  collectNumericIssues,
  collectVisibleTableCells,
  evaluateSumConstraint,
  pruneSumConstraints,
} from '@/lib/survey/numeric-validation';
import type { CalcCellValidation, CalcExpr, Question, SumConstraint, TableRow } from '@/types/survey';

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

  it('신규 연산자 ne/gt/lt', () => {
    const ne = { ...eq100, operator: 'ne' as const };
    const gt = { ...eq100, operator: 'gt' as const };
    const lt = { ...eq100, operator: 'lt' as const };
    expect(evaluateSumConstraint(ne, { c1: '60', c2: '30' }, ids).ok).toBe(true);
    expect(evaluateSumConstraint(ne, { c1: '60', c2: '40' }, ids).ok).toBe(false);
    expect(evaluateSumConstraint(gt, { c1: '60', c2: '41' }, ids).ok).toBe(true);
    expect(evaluateSumConstraint(gt, { c1: '60', c2: '40' }, ids).ok).toBe(false); // 경계: 같으면 false
    expect(evaluateSumConstraint(lt, { c1: '60', c2: '39' }, ids).ok).toBe(true);
    expect(evaluateSumConstraint(lt, { c1: '60', c2: '40' }, ids).ok).toBe(false);
  });

  it('tolerance 는 eq/ne 에만 적용되고 부등호는 무시한다', () => {
    const eqTol = { ...eq100, tolerance: 5 };
    expect(evaluateSumConstraint(eqTol, { c1: '60', c2: '36' }, ids).ok).toBe(true); // |96-100|<=5
    expect(evaluateSumConstraint(eqTol, { c1: '60', c2: '30' }, ids).ok).toBe(false);
    const neTol = { ...eq100, operator: 'ne' as const, tolerance: 5 };
    expect(evaluateSumConstraint(neTol, { c1: '60', c2: '36' }, ids).ok).toBe(false); // 밴드 안 = 같음 취급
    expect(evaluateSumConstraint(neTol, { c1: '60', c2: '30' }, ids).ok).toBe(true);
    const gteTol = { ...eq100, operator: 'gte' as const, tolerance: 5 };
    expect(evaluateSumConstraint(gteTol, { c1: '60', c2: '36' }, ids).ok).toBe(false); // 96 >= 100 아님 — tolerance 무시
  });

  describe('leftExpr / targetExpr 확장', () => {
    // q1 셀 c1,c2 픽스처(tableQuestion) + 숫자 단답 q2 를 ctx 로 구성
    const numQ = {
      id: 'q2', type: 'text', title: '예산', required: false, order: 1, inputType: 'number',
    } as Question;
    const mkCtx = (responses: Record<string, unknown>, contactAttrs: Record<string, string> = {}) => ({
      allResponses: responses,
      allQuestions: [tableQuestion(), numQ],
      lookups: [],
      contactAttrs,
    });
    const evalOpts = (ctx: ReturnType<typeof mkCtx>) => ({ ownQuestionId: 'q1', ctx });

    it('targetExpr: 셀 합계를 다른 질문 응답과 비교한다', () => {
      const c: SumConstraint = {
        id: 's4', cellIds: ['c1', 'c2'], operator: 'eq', target: 0,
        targetExpr: { kind: 'question', questionId: 'q2' },
      };
      const ctx = mkCtx({ q1: { c1: '60', c2: '40' }, q2: '100' });
      expect(evaluateSumConstraint(c, { c1: '60', c2: '40' }, ids, evalOpts(ctx)).ok).toBe(true);
      const ctxBad = mkCtx({ q1: { c1: '60', c2: '40' }, q2: '90' });
      expect(evaluateSumConstraint(c, { c1: '60', c2: '40' }, ids, evalOpts(ctxBad)).ok).toBe(false);
    });

    it('targetExpr: 컨택 attrs 와 비교한다', () => {
      const c: SumConstraint = {
        id: 's5', cellIds: ['c1', 'c2'], operator: 'lte', target: 0,
        targetExpr: { kind: 'attr', attrsKey: '예산' },
      };
      const ctx = mkCtx({ q1: { c1: '60', c2: '40' } }, { 예산: '120' });
      expect(evaluateSumConstraint(c, { c1: '60', c2: '40' }, ids, evalOpts(ctx)).ok).toBe(true);
    });

    it('targetExpr 평가 불능이면 skipped — fail-safe', () => {
      const c: SumConstraint = {
        id: 's6', cellIds: ['c1', 'c2'], operator: 'eq', target: 0,
        targetExpr: { kind: 'attr', attrsKey: '예산' },
      };
      const ctx = mkCtx({ q1: { c1: '60', c2: '40' } }, {}); // attrs 없음
      expect(evaluateSumConstraint(c, { c1: '60', c2: '40' }, ids, evalOpts(ctx)).skipped).toBe(true);
    });

    it('targetExpr 있는데 evalOpts 미전달이면 skipped — fail-safe', () => {
      const c: SumConstraint = {
        id: 's7', cellIds: ['c1', 'c2'], operator: 'eq', target: 0,
        targetExpr: { kind: 'question', questionId: 'q2' },
      };
      expect(evaluateSumConstraint(c, { c1: '60', c2: '40' }, ids).skipped).toBe(true);
    });

    it('leftExpr: 좌변을 수식으로 평가하고 cellIds 는 무시한다', () => {
      const c: SumConstraint = {
        id: 's8', cellIds: [], operator: 'gte', target: 50,
        leftExpr: {
          kind: 'group', op: '*',
          terms: [{ kind: 'cell', cellId: 'c1' }, { kind: 'literal', value: 2 }],
        },
      };
      const ctx = mkCtx({ q1: { c1: '30' } });
      const r = evaluateSumConstraint(c, { c1: '30' }, ids, evalOpts(ctx));
      expect(r).toMatchObject({ skipped: false, ok: true, sum: 60 });
    });

    it('leftExpr 평가 불능이면 skipped — fail-safe', () => {
      const c: SumConstraint = {
        id: 's9', cellIds: [], operator: 'eq', target: 100,
        leftExpr: { kind: 'attr', attrsKey: '없는키' },
      };
      const ctx = mkCtx({ q1: { c1: '30' } });
      expect(evaluateSumConstraint(c, { c1: '30' }, ids, evalOpts(ctx)).skipped).toBe(true);
    });

    it('leftExpr/targetExpr 의 전부-빈-참조도 skipped', () => {
      const gEmpty: CalcExpr = {
        kind: 'group', op: '+', terms: [{ kind: 'question', questionId: 'q2' }],
      };
      const cLeft: SumConstraint = { id: 'sx1', cellIds: [], operator: 'eq', target: 100, leftExpr: gEmpty };
      const cTarget: SumConstraint = { id: 'sx2', cellIds: ['c1', 'c2'], operator: 'eq', target: 0, targetExpr: gEmpty };
      const q = tableQuestion();
      const numQ = { id: 'q2', type: 'text', title: '', required: false, order: 1, inputType: 'number' } as Question;
      const opts = {
        ownQuestionId: 'q1',
        ctx: { allResponses: { q1: { c1: '60', c2: '40' } }, allQuestions: [q, numQ] },
      };
      const ids = new Set(['c1', 'c2']);
      expect(evaluateSumConstraint(cLeft, { c1: '60', c2: '40' }, ids, opts).skipped).toBe(true);
      expect(evaluateSumConstraint(cTarget, { c1: '60', c2: '40' }, ids, opts).skipped).toBe(true);
    });

    describe('existingCellIds 마스킹 — 화면에서 제외된 잔존값은 수식에 되살아나지 않는다', () => {
      // 미선택 동적 행·isHidden 셀은 값이 보존되지만 existingCellIds 에서 빠진다.
      // 레거시 cellIds 경로와 동일하게 수식의 자기 질문 셀 참조도 이 집합으로 걸러야 한다.
      const sumExpr: CalcExpr = {
        kind: 'group', op: '+',
        terms: [{ kind: 'cell', cellId: 'c1' }, { kind: 'cell', cellId: 'c2' }],
      };

      it('leftExpr: existingCellIds 에 없는 셀의 잔존값은 합산에서 제외된다', () => {
        const c: SumConstraint = {
          id: 'sm1', cellIds: [], operator: 'eq', target: 30, leftExpr: sumExpr,
        };
        // c2 는 화면에서 제외됐지만 응답에는 잔존값 70 이 남아 있다
        const ctx = mkCtx({ q1: { c1: '30', c2: '70' } });
        const visibleOnly = new Set(['c1']);
        const r = evaluateSumConstraint(c, { c1: '30' }, visibleOnly, evalOpts(ctx));
        expect(r).toMatchObject({ skipped: false, ok: true, sum: 30 });
      });

      it('leftExpr: 보이는 참조가 전부 빈 값이면 잔존값이 있어도 skipped', () => {
        const c: SumConstraint = {
          id: 'sm2', cellIds: [], operator: 'eq', target: 100, leftExpr: sumExpr,
        };
        // 보이는 c1 은 빈 값, 숨은 c2 에만 잔존값 — 전부-빈-참조 의미론으로 skipped
        const ctx = mkCtx({ q1: { c2: '70' } });
        const visibleOnly = new Set(['c1']);
        expect(evaluateSumConstraint(c, {}, visibleOnly, evalOpts(ctx)).skipped).toBe(true);
      });

      it('targetExpr: 기준값 수식의 자기 질문 셀 참조도 동일하게 마스킹된다', () => {
        const c: SumConstraint = {
          id: 'sm3', cellIds: ['c1'], operator: 'eq', target: 0,
          targetExpr: { kind: 'cell', cellId: 'c2' },
        };
        // 숨은 c2 잔존값 70 이 기준값으로 쓰이면 30 != 70 오차단 — 마스킹되면 빈 참조로 skipped
        const ctx = mkCtx({ q1: { c1: '30', c2: '70' } });
        const visibleOnly = new Set(['c1']);
        expect(evaluateSumConstraint(c, { c1: '30' }, visibleOnly, evalOpts(ctx)).skipped).toBe(true);
      });

      it('leftExpr: 다른 질문 참조는 마스킹 대상이 아니다', () => {
        const c: SumConstraint = {
          id: 'sm4', cellIds: [], operator: 'eq', target: 130,
          leftExpr: {
            kind: 'group', op: '+',
            terms: [{ kind: 'cell', cellId: 'c1' }, { kind: 'question', questionId: 'q2' }],
          },
        };
        const ctx = mkCtx({ q1: { c1: '30' }, q2: '100' });
        const visibleOnly = new Set(['c1']);
        const r = evaluateSumConstraint(c, { c1: '30' }, visibleOnly, evalOpts(ctx));
        expect(r).toMatchObject({ skipped: false, ok: true, sum: 130 });
      });
    });
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

  it('미접촉 표의 입력 기반 검증(합계 등)은 여전히 스킵된다', () => {
    const q = tableQuestion({ sumConstraints: [eq100] });
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

  it('셀 requiredMessage 지정 시 그 문구로 별도 이슈를 만들고, 미지정 셀은 기본 문구로 묶는다', () => {
    const rows: TableRow[] = [
      {
        id: 'r1',
        cells: [
          {
            id: 'c1',
            type: 'input',
            content: '',
            inputType: 'number',
            required: true,
            requiredMessage: '연령을 입력해 주세요',
          },
          { id: 'c2', type: 'input', content: '', inputType: 'number', required: true },
          { id: 'c3', type: 'input', content: '', inputType: 'number' },
        ],
      },
    ] as TableRow[];
    const q = tableQuestion({ tableRowsData: rows });
    const issues = collectNumericIssues(q, { c3: '5' });
    expect(issues).toHaveLength(2);
    expect(issues).toContainEqual(
      expect.objectContaining({
        kind: 'required-cells',
        message: '연령을 입력해 주세요',
        cellIds: ['c1'],
      }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        kind: 'required-cells',
        message: '필수 응답이 비어있습니다',
        cellIds: ['c2'],
      }),
    );
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

  it('연결 동적 그룹의 선택 행이 생길 때만 showWhenDynamicGroupId 행을 표시한다', () => {
    const rows: TableRow[] = [
      {
        id: 'base',
        label: '기본 행',
        cells: [{ id: 'base-cell', type: 'input', content: '' }],
      },
      {
        id: 'dynamic',
        label: '동적 행',
        dynamicGroupId: 'g1',
        cells: [{ id: 'dynamic-cell', type: 'input', content: '' }],
      },
      {
        id: 'subtotal',
        label: '소계 행',
        showWhenDynamicGroupId: 'g1',
        cells: [{ id: 'subtotal-cell', type: 'input', content: '', required: true }],
      },
    ] as TableRow[];
    const q = tableQuestion({
      tableRowsData: rows,
      dynamicRowConfigs: [{ groupId: 'g1', enabled: true }],
    } as Partial<Question>);

    expect(collectVisibleTableCells(q, {}, undefined).map((cell) => cell.id))
      .toEqual(['base-cell']);
    expect(collectVisibleTableCells(q, { __selectedRowIds: ['dynamic'] }, undefined).map((cell) => cell.id))
      .toEqual(['base-cell', 'dynamic-cell', 'subtotal-cell']);
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

  it('targetExpr 규칙: ctx 를 통해 평가되고 위반 메시지는 기준값을 노출하지 않는다', () => {
    const q = tableQuestion({
      sumConstraints: [{
        id: 's10', cellIds: ['c1', 'c2'], operator: 'eq', target: 0,
        targetExpr: { kind: 'question', questionId: 'q2' },
      }],
    });
    const numQ = {
      id: 'q2', type: 'text', title: '예산', required: false, order: 1, inputType: 'number',
    } as Question;
    const ctx = {
      allResponses: { q1: { c1: '60', c2: '30' }, q2: '100' },
      allQuestions: [q, numQ],
    };
    const issues = collectNumericIssues(q, { c1: '60', c2: '30' }, ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'sum' });
    expect(issues[0]!.message).toContain('기준값');
    expect(issues[0]!.message).not.toContain('100');
  });

  it('leftExpr 규칙 위반 issue 는 cellIds 없이 메시지만 담는다', () => {
    const q = tableQuestion({
      sumConstraints: [{
        id: 's11', cellIds: [], operator: 'gte', target: 100,
        leftExpr: { kind: 'cell', cellId: 'c1' },
      }],
    });
    const ctx = { allResponses: { q1: { c1: '50' } }, allQuestions: [q] };
    const issues = collectNumericIssues(q, { c1: '50' }, ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.cellIds).toBeUndefined();
  });
});

describe('pruneSumConstraints', () => {
  it('존재하지 않는 cellId 를 제거한다', () => {
    const rows = tableQuestion().tableRowsData!;
    const pruned = pruneSumConstraints([{ ...eq100, cellIds: ['c1', 'ghost'] }], rows);
    expect(pruned[0]!.cellIds).toEqual(['c1']);
  });
});

describe('collectNumericIssues — 인터랙티브 셀 필수 (radio/checkbox/select/ranking)', () => {
  function interactiveQuestion(): Question {
    const rows: TableRow[] = [
      {
        id: 'r1',
        label: '행1',
        cells: [
          {
            id: 'radio-1',
            type: 'radio',
            content: '',
            required: true,
            radioOptions: [{ id: 'o1', label: '예', value: '1' }],
          },
          {
            id: 'check-1',
            type: 'checkbox',
            content: '',
            required: true,
            checkboxOptions: [{ id: 'k1', label: 'A', value: 'A' }],
          },
          {
            id: 'sel-1',
            type: 'select',
            content: '',
            required: true,
            selectOptions: [{ id: 's1', label: 'S', value: 'S' }],
          },
          {
            id: 'rank-1',
            type: 'ranking',
            content: '',
            required: true,
            rankingOptions: [{ id: 'ro1', label: '가', value: 'ga' }],
          },
          { id: 'free-1', type: 'input', content: '' },
        ],
      },
    ] as TableRow[];
    return tableQuestion({ tableRowsData: rows });
  }

  const answeredAll = {
    'radio-1': '1', // flat value 저장 형태
    'check-1': ['A'],
    'sel-1': 'S',
    'rank-1': [{ rank: 1, optionValue: 'ga' }],
  };

  it('접촉 후 미응답인 필수 인터랙티브 셀을 전부 잡는다', () => {
    const issues = collectNumericIssues(interactiveQuestion(), { 'free-1': 'x' });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: 'required-cells',
      cellIds: ['radio-1', 'check-1', 'sel-1', 'rank-1'],
    });
  });

  it('전 타입 응답 시 위반 없음', () => {
    expect(collectNumericIssues(interactiveQuestion(), answeredAll)).toHaveLength(0);
  });

  it('checkbox 빈 배열·ranking 빈 배열은 미응답으로 본다', () => {
    const issues = collectNumericIssues(interactiveQuestion(), {
      ...answeredAll,
      'check-1': [],
      'rank-1': [],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'required-cells', cellIds: ['check-1', 'rank-1'] });
  });

  it('테이블 미접촉이면 인터랙티브 필수 셀도 스킵한다', () => {
    expect(collectNumericIssues(interactiveQuestion(), {})).toHaveLength(0);
  });
});

describe('collectNumericIssues — 질문 상세기입', () => {
  it('필수 radio 질문의 선택 상세기입이 공백이면 질문 이동 타깃이 있는 이슈를 반환한다', () => {
    const question = {
      id: 'question-detail',
      type: 'radio',
      title: '기타 질문',
      required: true,
      order: 0,
      options: [{
        id: 'other-option',
        value: 'other',
        label: '기타',
        allowTextInput: true,
      }],
    } as Question;

    expect(
      collectNumericIssues(question, 'other', {
        allResponses: { 'question-detail': 'other' },
        allQuestions: [question],
        optionTexts: { 'other-option': '   ' },
      }),
    ).toEqual([{
      kind: 'required-detail',
      message: '필수 응답이 비어있습니다',
      detailTargetIds: ['question-detail:option:other-option'],
    }]);
  });
});

describe('collectNumericIssues — 테이블 필수 옵션 상세기입', () => {
  function detailedOptionCellQuestion(overrides: Partial<Question> = {}): Question {
    return tableQuestion({
      tableRowsData: [
        {
          id: 'r1',
          label: '행1',
          cells: [
            {
              id: 'radio-cell',
              type: 'radio',
              content: '',
              required: true,
              radioOptions: [
                {
                  id: 'radio-other',
                  value: 'radio-other-value',
                  label: '기타',
                  allowTextInput: true,
                },
              ],
            },
            {
              id: 'checkbox-cell',
              type: 'checkbox',
              content: '',
              required: true,
              checkboxOptions: [
                {
                  id: 'checkbox-other',
                  value: 'checkbox-other-value',
                  label: '기타',
                  allowTextInput: true,
                },
              ],
            },
            {
              id: 'select-cell',
              type: 'select',
              content: '',
              required: true,
              selectOptions: [
                {
                  id: 'select-other',
                  value: 'select-other-value',
                  label: '기타',
                  allowTextInput: true,
                },
              ],
            },
            {
              id: 'ranking-cell',
              type: 'ranking',
              content: '',
              required: true,
              rankingOptions: [
                {
                  id: 'ranking-other',
                  value: 'ranking-other-value',
                  label: '기타',
                  allowTextInput: true,
                },
              ],
            },
          ],
        },
      ] as TableRow[],
      ...overrides,
    });
  }

  it('필수 radio 셀에서 선택한 상세기입 옵션이 공백이면 required-cells 이슈다', () => {
    const question = detailedOptionCellQuestion();

    expect(
      collectNumericIssues(
        question,
        {
          'radio-cell': 'radio-other-value',
          'checkbox-cell': ['checkbox-other-value'],
          'select-cell': 'select-other-value',
          'ranking-cell': [{ rank: 1, optionValue: 'ranking-other-value', optionText: '상세 내용' }],
        },
        {
          allResponses: {},
          allQuestions: [question],
          optionTexts: {
            'radio-other': '   ',
            'checkbox-other': '상세 내용',
            'select-other': '상세 내용',
          },
        },
      ),
    ).toContainEqual({
      kind: 'required-cells',
      message: '필수 응답이 비어있습니다',
      cellIds: ['radio-cell'],
      detailTargetIds: ['q1:option:radio-other'],
    });
  });

  it('필수 checkbox·select·ranking 셀의 선택 상세기입 누락을 같은 이슈로 합친다', () => {
    const question = detailedOptionCellQuestion();

    expect(
      collectNumericIssues(
        question,
        {
          'radio-cell': 'radio-other-value',
          'checkbox-cell': ['checkbox-other-value'],
          'select-cell': 'select-other-value',
          'ranking-cell': [{ rank: 1, optionValue: 'ranking-other-value', optionText: '   ' }],
        },
        {
          allResponses: {},
          allQuestions: [question],
          optionTexts: {
            'radio-other': '상세 내용',
            'checkbox-other': '',
            'select-other': ' ',
          },
        },
      ),
    ).toContainEqual({
      kind: 'required-cells',
      message: '필수 응답이 비어있습니다',
      cellIds: ['checkbox-cell', 'select-cell', 'ranking-cell'],
      detailTargetIds: [
        'q1:option:checkbox-other',
        'q1:option:select-other',
        'ranking-cell:ranking:1:ranking-other-value',
      ],
    });
  });

  it('유효한 상세기입과 선택 사항 셀의 빈 상세기입은 차단하지 않는다', () => {
    const question = detailedOptionCellQuestion({
      tableRowsData: [
        {
          id: 'r1',
          label: '행1',
          cells: [
            {
              id: 'required-radio',
              type: 'radio',
              content: '',
              required: true,
              radioOptions: [
                { id: 'required-other', value: 'required-other', label: '기타', allowTextInput: true },
              ],
            },
            {
              id: 'optional-radio',
              type: 'radio',
              content: '',
              required: false,
              radioOptions: [
                { id: 'optional-other', value: 'optional-other', label: '기타', allowTextInput: true },
              ],
            },
          ],
        },
      ] as TableRow[],
    });

    expect(
      collectNumericIssues(
        question,
        { 'required-radio': 'required-other', 'optional-radio': 'optional-other' },
        {
          allResponses: {},
          allQuestions: [question],
          optionTexts: { 'required-other': '상세 내용', 'optional-other': '   ' },
        },
      ),
    ).toHaveLength(0);
  });

  it('숨은 필수 셀의 선택 상세기입 누락은 required-cells 이슈에서 제외한다', () => {
    const question = detailedOptionCellQuestion({
      tableRowsData: [
        {
          id: 'r1',
          label: '행1',
          cells: [
            { id: 'visible-cell', type: 'input', content: '' },
            {
              id: 'hidden-radio',
              type: 'radio',
              content: '',
              required: true,
              isHidden: true,
              radioOptions: [
                { id: 'hidden-other', value: 'hidden-other', label: '기타', allowTextInput: true },
              ],
            },
          ],
        },
      ] as TableRow[],
    });

    expect(
      collectNumericIssues(
        question,
        { 'visible-cell': '입력', 'hidden-radio': 'hidden-other' },
        {
          allResponses: {},
          allQuestions: [question],
          optionTexts: { 'hidden-other': '' },
        },
      ),
    ).toHaveLength(0);
  });

  it('상세기입 옵션을 선택하지 않으면 빈 텍스트가 남아도 차단하지 않는다', () => {
    const question = detailedOptionCellQuestion({
      tableRowsData: [
        {
          id: 'r1',
          label: '행1',
          cells: [
            {
              id: 'radio-cell',
              type: 'radio',
              content: '',
              required: true,
              radioOptions: [
                { id: 'normal', value: 'normal', label: '일반' },
                { id: 'other', value: 'other', label: '기타', allowTextInput: true },
              ],
            },
          ],
        },
      ] as TableRow[],
    });

    expect(
      collectNumericIssues(
        question,
        { 'radio-cell': 'normal' },
        {
          allResponses: {},
          allQuestions: [question],
          optionTexts: { other: '   ' },
        },
      ),
    ).toHaveLength(0);
  });

  it('일반 필수 미입력과 상세기입 누락이 겹쳐도 셀 ID는 한 번만 반환한다', () => {
    const question = detailedOptionCellQuestion({
      tableRowsData: [
        {
          id: 'r1',
          label: '행1',
          cells: [
            {
              id: 'empty-value-radio',
              type: 'radio',
              content: '',
              required: true,
              radioOptions: [
                { id: 'empty-other', value: '', label: '기타', allowTextInput: true },
              ],
            },
          ],
        },
      ] as TableRow[],
    });

    expect(
      collectNumericIssues(
        question,
        { 'empty-value-radio': '' },
        {
          allResponses: {},
          allQuestions: [question],
          optionTexts: { 'empty-other': '' },
        },
      ),
    ).toContainEqual({
      kind: 'required-cells',
      message: '필수 응답이 비어있습니다',
      cellIds: ['empty-value-radio'],
      detailTargetIds: ['q1:option:empty-other'],
    });
  });

  it('조건부 행·열의 숨은 상세기입 셀은 잔존 선택값이 있어도 제외하고, 보이면 차단한다', () => {
    const controller = {
      id: 'controller',
      type: 'radio',
      title: '표시 제어',
      required: false,
      order: 0,
      options: [{ id: 'show', value: 'show', label: '표시' }],
    } as Question;
    const showWhenController = {
      conditions: [
        {
          id: 'show-controller',
          sourceQuestionId: controller.id,
          conditionType: 'value-match' as const,
          requiredValues: ['show'],
          logicType: 'AND' as const,
        },
      ],
      logicType: 'AND' as const,
    };
    const question = detailedOptionCellQuestion({
      tableColumns: [
        { id: 'always-column', label: '항상 표시' },
        { id: 'conditional-column', label: '조건부 열', displayCondition: showWhenController },
      ],
      tableRowsData: [
        {
          id: 'conditional-row',
          label: '조건부 행',
          displayCondition: showWhenController,
          cells: [
            {
              id: 'row-detail',
              type: 'radio',
              content: '',
              required: true,
              radioOptions: [{ id: 'row-other', value: 'row-other', label: '기타', allowTextInput: true }],
            },
            { id: 'row-filler', type: 'input', content: '' },
          ],
        },
        {
          id: 'column-row',
          label: '열 조건 행',
          cells: [
            { id: 'column-support', type: 'input', content: '' },
            {
              id: 'column-detail',
              type: 'radio',
              content: '',
              required: true,
              radioOptions: [{ id: 'column-other', value: 'column-other', label: '기타', allowTextInput: true }],
            },
          ],
        },
      ] as TableRow[],
    });
    const response = {
      'row-detail': 'row-other',
      'column-support': '입력',
      'column-detail': 'column-other',
    };
    const optionTexts = { 'row-other': '', 'column-other': '' };

    expect(
      collectNumericIssues(question, response, {
        allResponses: { [controller.id]: 'hide' },
        allQuestions: [controller, question],
        optionTexts,
      }),
    ).toHaveLength(0);
    expect(
      collectNumericIssues(question, response, {
        allResponses: { [controller.id]: 'show' },
        allQuestions: [controller, question],
        optionTexts,
      }),
    ).toContainEqual({
      kind: 'required-cells',
      message: '필수 응답이 비어있습니다',
      cellIds: ['row-detail', 'column-detail'],
      detailTargetIds: ['q1:option:row-other', 'q1:option:column-other'],
    });
  });

  it('미선택 동적 행과 연결 행의 상세기입은 제외하고, 그룹을 선택하면 차단한다', () => {
    const question = detailedOptionCellQuestion({
      dynamicRowConfigs: [{ groupId: 'g1', enabled: true }],
      tableRowsData: [
        {
          id: 'dynamic-row',
          label: '동적 행',
          dynamicGroupId: 'g1',
          cells: [
            {
              id: 'dynamic-detail',
              type: 'radio',
              content: '',
              required: true,
              radioOptions: [{ id: 'dynamic-other', value: 'dynamic-other', label: '기타', allowTextInput: true }],
            },
          ],
        },
        {
          id: 'linked-row',
          label: '연결 행',
          showWhenDynamicGroupId: 'g1',
          cells: [
            {
              id: 'linked-detail',
              type: 'radio',
              content: '',
              required: true,
              radioOptions: [{ id: 'linked-other', value: 'linked-other', label: '기타', allowTextInput: true }],
            },
          ],
        },
      ] as TableRow[],
    });
    const ctx = {
      allResponses: {},
      allQuestions: [question],
      optionTexts: { 'dynamic-other': '', 'linked-other': '' },
    };

    expect(
      collectNumericIssues(
        question,
        { 'dynamic-detail': 'dynamic-other', 'linked-detail': 'linked-other' },
        ctx,
      ),
    ).toHaveLength(0);
    expect(
      collectNumericIssues(
        question,
        {
          'dynamic-detail': 'dynamic-other',
          'linked-detail': 'linked-other',
          __selectedRowIds: ['dynamic-row'],
        },
        ctx,
      ),
    ).toContainEqual({
      kind: 'required-cells',
      message: '필수 응답이 비어있습니다',
      cellIds: ['dynamic-detail', 'linked-detail'],
      detailTargetIds: ['q1:option:dynamic-other', 'q1:option:linked-other'],
    });
  });

  it('조건으로 숨은 동적 그룹은 잔존 선택 행과 연결 행을 제외하고, 다시 보이면 차단한다', () => {
    const controller = {
      id: 'dynamic-controller',
      type: 'radio',
      title: '동적 그룹 표시',
      required: false,
      order: 0,
      options: [{ id: 'show', value: 'show', label: '표시' }],
    } as Question;
    const displayCondition = {
      conditions: [
        {
          id: 'show-dynamic-group',
          sourceQuestionId: controller.id,
          conditionType: 'value-match' as const,
          requiredValues: ['show'],
          logicType: 'AND' as const,
        },
      ],
      logicType: 'AND' as const,
    };
    const question = detailedOptionCellQuestion({
      dynamicRowConfigs: [{ groupId: 'conditional-group', enabled: true, displayCondition }],
      tableRowsData: [
        {
          id: 'conditional-dynamic-row',
          label: '동적 행',
          dynamicGroupId: 'conditional-group',
          cells: [
            {
              id: 'conditional-dynamic-detail',
              type: 'radio',
              content: '',
              required: true,
              radioOptions: [
                {
                  id: 'conditional-dynamic-other',
                  value: 'conditional-dynamic-other',
                  label: '기타',
                  allowTextInput: true,
                },
              ],
            },
          ],
        },
        {
          id: 'conditional-linked-row',
          label: '연결 행',
          showWhenDynamicGroupId: 'conditional-group',
          cells: [
            {
              id: 'conditional-linked-detail',
              type: 'radio',
              content: '',
              required: true,
              radioOptions: [
                {
                  id: 'conditional-linked-other',
                  value: 'conditional-linked-other',
                  label: '기타',
                  allowTextInput: true,
                },
              ],
            },
          ],
        },
      ] as TableRow[],
    });
    const response = {
      'conditional-dynamic-detail': 'conditional-dynamic-other',
      'conditional-linked-detail': 'conditional-linked-other',
      __selectedRowIds: ['conditional-dynamic-row'],
    };
    const baseCtx = {
      allQuestions: [controller, question],
      optionTexts: {
        'conditional-dynamic-other': '',
        'conditional-linked-other': '',
      },
    };

    expect(
      collectNumericIssues(question, response, {
        ...baseCtx,
        allResponses: { [controller.id]: 'hide' },
      }),
    ).toHaveLength(0);
    expect(
      collectNumericIssues(question, response, {
        ...baseCtx,
        allResponses: { [controller.id]: 'show' },
      }),
    ).toContainEqual({
      kind: 'required-cells',
      message: '필수 응답이 비어있습니다',
      cellIds: ['conditional-dynamic-detail', 'conditional-linked-detail'],
      detailTargetIds: [
        'q1:option:conditional-dynamic-other',
        'q1:option:conditional-linked-other',
      ],
    });
  });
});

describe('collectNumericIssues — 열 displayCondition (ctx 전달)', () => {
  const srcQ = {
    id: 'src',
    type: 'radio',
    title: '장르',
    required: true,
    order: 0,
    options: [
      { id: 'o1', label: 'A', value: 'A' },
      { id: 'o2', label: 'B', value: 'B' },
    ],
  } as Question;

  const colCondition = (value: string) => ({
    conditions: [
      {
        id: `cond-${value}`,
        sourceQuestionId: 'src',
        conditionType: 'value-match',
        requiredValues: [value],
        logicType: 'AND',
      },
    ],
    logicType: 'AND',
  });

  /** 열 2개(A/B) 각각 value-match displayCondition + 필수 input 셀 1개씩 */
  function columnConditionQuestion(): Question {
    return {
      id: 'q1',
      type: 'table',
      title: '표',
      required: true,
      order: 1,
      tableColumns: [
        { id: 'colA', label: 'A', displayCondition: colCondition('A') },
        { id: 'colB', label: 'B', displayCondition: colCondition('B') },
      ],
      tableRowsData: [
        {
          id: 'r1',
          cells: [
            { id: 'cA', type: 'input', content: '', inputType: 'number', required: true },
            { id: 'cB', type: 'input', content: '', inputType: 'number', required: true },
          ],
        },
      ],
    } as unknown as Question;
  }

  it('숨은 열의 필수 셀은 제외 — 보이는 열만 채우면 통과 (장르별 열 영구 차단 회귀)', () => {
    const q = columnConditionQuestion();
    const ctx = { allResponses: { src: 'A' }, allQuestions: [srcQ, q] };
    expect(collectNumericIssues(q, { cA: '10' }, ctx)).toHaveLength(0);
  });

  it('보이는 열의 필수 셀 미입력은 여전히 차단', () => {
    const q = columnConditionQuestion();
    const ctx = { allResponses: { src: 'A' }, allQuestions: [srcQ, q] };
    const issues = collectNumericIssues(q, { cB: '5' }, ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'required-cells', cellIds: ['cA'] });
  });

  it('ctx 미전달이면 조건 평가 없이 기존 동작 유지', () => {
    const q = columnConditionQuestion();
    const issues = collectNumericIssues(q, { cA: '10' });
    expect(issues[0]).toMatchObject({ kind: 'required-cells', cellIds: ['cB'] });
  });
});

describe('collectNumericIssues — 계산 셀 비교 검증', () => {
  // c1 입력 셀 + k1 = c1 × 2 계산 셀 픽스처
  const calcQ = (calcValidation: CalcCellValidation): Question =>
    ({
      id: 'q1', type: 'table', title: '표', required: false, order: 0,
      tableRowsData: [
        {
          id: 'r1',
          cells: [
            { id: 'c1', type: 'input', content: '', inputType: 'number' },
            {
              id: 'k1', type: 'calc', content: '',
              formula: {
                kind: 'group', op: '*',
                terms: [{ kind: 'cell', cellId: 'c1' }, { kind: 'literal', value: 2 }],
              },
              calcValidation,
            },
          ],
        },
      ],
    }) as unknown as Question;
  const numQ = {
    id: 'q2', type: 'text', title: '예산', required: false, order: 1, inputType: 'number',
  } as Question;
  const ctxOf = (
    q: Question,
    responses: Record<string, unknown>,
    contactAttrs: Record<string, string> = {},
  ) => ({ allResponses: responses, allQuestions: [q, numQ], contactAttrs });

  it('계산값이 기준 수식을 위반하면 formula issue + 계산 셀 하이라이트', () => {
    const q = calcQ({ operator: 'lte', target: { kind: 'question', questionId: 'q2' } });
    const ctx = ctxOf(q, { q1: { c1: '60' }, q2: '100' }); // 120 <= 100 위반
    const issues = collectNumericIssues(q, { c1: '60' }, ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'formula', cellIds: ['k1'] });
    expect(issues[0]!.message).toContain('기준값');
  });

  it('충족하면 issue 없음', () => {
    const q = calcQ({ operator: 'lte', target: { kind: 'question', questionId: 'q2' } });
    const ctx = ctxOf(q, { q1: { c1: '40' }, q2: '100' }); // 80 <= 100
    expect(collectNumericIssues(q, { c1: '40' }, ctx)).toHaveLength(0);
  });

  it('errorMessage 지정 시 그 문구 사용', () => {
    const q = calcQ({
      operator: 'lte', target: { kind: 'question', questionId: 'q2' },
      errorMessage: '합계가 예산을 초과했습니다',
    });
    const ctx = ctxOf(q, { q1: { c1: '60' }, q2: '100' });
    expect(collectNumericIssues(q, { c1: '60' }, ctx)[0]!.message).toContain('합계가 예산을 초과했습니다');
  });

  it('tolerance 는 eq 에서 밴드로 적용된다', () => {
    const q = calcQ({ operator: 'eq', target: { kind: 'question', questionId: 'q2' }, tolerance: 5 });
    const okCtx = ctxOf(q, { q1: { c1: '49' }, q2: '100' }); // 98, |98-100|<=5
    expect(collectNumericIssues(q, { c1: '49' }, okCtx)).toHaveLength(0);
    const badCtx = ctxOf(q, { q1: { c1: '45' }, q2: '100' }); // 90
    expect(collectNumericIssues(q, { c1: '45' }, badCtx)).toHaveLength(1);
  });

  it('기준 수식 평가 불능이면 통과 — fail-safe', () => {
    const q = calcQ({ operator: 'eq', target: { kind: 'attr', attrsKey: '없는키' } });
    const ctx = ctxOf(q, { q1: { c1: '60' } });
    expect(collectNumericIssues(q, { c1: '60' }, ctx)).toHaveLength(0);
  });

  it('ctx 미전달이면 통과 — fail-safe', () => {
    const q = calcQ({ operator: 'lte', target: { kind: 'question', questionId: 'q2' } });
    expect(collectNumericIssues(q, { c1: '60' })).toHaveLength(0);
  });

  it('미접촉 표에서도 계산 셀 검증은 실행된다 — 우회 봉합', () => {
    // Q17 표를 통째로 건너뛴 응답자: SUM 은 0으로 표시되고 Q16=1 과 불일치 → 차단
    const q = calcQ({ operator: 'eq', target: { kind: 'question', questionId: 'q2' } });
    const ctx = ctxOf(q, { q2: '1' }); // q1 응답 없음
    const issues = collectNumericIssues(q, undefined, ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'formula', cellIds: ['k1'] });
  });

  it('기준값 수식의 참조가 전부 빈 값이면 스킵 — group 래핑 무응답 오차단 방지', () => {
    // 에디터가 만드는 형태: group(+, [question]) — 무응답이면 0이 아니라 스킵이어야 한다
    const q = calcQ({
      operator: 'eq',
      target: { kind: 'group', op: '+', terms: [{ kind: 'question', questionId: 'q2' }] },
    });
    const ctx = ctxOf(q, { q1: { c1: '30' } }); // q2 무응답 — computed 60 vs 0 비교가 아니라 스킵
    expect(collectNumericIssues(q, { c1: '30' }, ctx)).toHaveLength(0);
  });

  it('기준값 참조가 일부만 비어 있으면 스킵하지 않고 0 취급으로 비교한다', () => {
    // q2 무응답 + q3 응답 30 — 참조가 하나라도 해소되면 스킵 없이 q2=0 취급으로 비교한다.
    // literal 은 areAllFormulaRefsEmpty 의 refs 에 안 잡히므로 refs=[q2] 뿐인 이전 픽스처는
    // skip 경로와 비교 경로가 같은 값(60=60)으로 수렴해 Fix 2 를 제거해도 통과하는 무의미한
    // 단언이었다 — refs=[q2, q3] 로 갈아끼워 두 경로가 실제로 갈리게 한다.
    const q = calcQ({
      operator: 'eq',
      target: {
        kind: 'group', op: '+',
        terms: [
          { kind: 'question', questionId: 'q2' },
          { kind: 'question', questionId: 'q3' },
        ],
      },
    });
    const q3 = {
      id: 'q3', type: 'text', title: '', required: false, order: 2, inputType: 'number',
    } as Question;
    const ctx = {
      allResponses: { q1: { c1: '30' }, q3: '30' }, // computed 60, 기준값 0(q2 무응답)+30 = 30 — 위반
      allQuestions: [q, numQ, q3],
      contactAttrs: {},
    };
    const issues = collectNumericIssues(q, { c1: '30' }, ctx);
    expect(issues).toHaveLength(1); // 스킵됐다면 0건 — skip 경로와 비교 경로가 실제로 갈리는 단언
    expect(issues[0]).toMatchObject({ kind: 'formula', cellIds: ['k1'] });
  });
});
