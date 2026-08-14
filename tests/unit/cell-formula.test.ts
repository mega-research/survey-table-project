import { describe, expect, it } from 'vitest';
import { areAllFormulaRefsEmpty, evaluateCellFormula, roundFormulaValue } from '@/lib/survey/cell-formula';
import type { CalcExpr, Question } from '@/types/survey';

// 최소 표 질문 헬퍼 — 숫자 input 셀 2개(a1, a2) + calc 셀(c1)
function tableQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1', type: 'table', title: 'T', required: false, order: 1,
    tableRowsData: [
      {
        id: 'r1',
        label: 'r1',
        cells: [
          { id: 'a1', content: '', type: 'input', inputType: 'number' },
          { id: 'a2', content: '', type: 'input', inputType: 'number' },
          { id: 'c1', content: '', type: 'calc' },
        ],
      },
    ],
    ...overrides,
  } as Question;
}

const baseCtx = (responses: Record<string, unknown>, questions?: Question[]) => ({
  questions: questions ?? [tableQuestion()],
  responses,
  lookups: [],
  contactAttrs: {},
});

describe('roundFormulaValue', () => {
  it('기본 소수 2자리로 반올림한다', () => {
    expect(roundFormulaValue(0.30000000000000004, undefined)).toBe(0.3);
    expect(roundFormulaValue(3.456, undefined)).toBe(3.46);
  });
  it('decimalPlaces 를 지정하면 그 자리로 반올림한다', () => {
    expect(roundFormulaValue(3.456, 1)).toBe(3.5);
    expect(roundFormulaValue(3.5, 0)).toBe(4);
  });
});

describe('evaluateCellFormula', () => {
  it('그룹 중첩 (n*m)+(x*y) 를 계산한다', () => {
    const expr: CalcExpr = {
      kind: 'group', op: '+',
      terms: [
        { kind: 'group', op: '*', terms: [{ kind: 'literal', value: 2 }, { kind: 'literal', value: 3 }] },
        { kind: 'group', op: '*', terms: [{ kind: 'literal', value: 4 }, { kind: 'literal', value: 5 }] },
      ],
    };
    expect(evaluateCellFormula(expr, 'q1', baseCtx({}))).toBe(26);
  });

  // 저장되는 raw 값은 콤마 없는 문자열이다 (콤마는 표시 전용 — parseNumericInput 은
  // '1,500' 을 null 로 거부한다: numeric-input.ts STRICT_NUMERIC_PATTERN).
  it('셀 참조는 responses[qid][cellId] 문자열을 숫자로 읽는다 (questionId 생략 = 자기 질문)', () => {
    const expr: CalcExpr = { kind: 'cell', cellId: 'a1' };
    expect(evaluateCellFormula(expr, 'q1', baseCtx({ q1: { a1: '1500' } }))).toBe(1500);
  });

  it('콤마가 섞인 값은 파싱 불가 — 빈 항으로 강등된다', () => {
    const expr: CalcExpr = {
      kind: 'agg', fn: 'sum',
      items: [{ kind: 'cell', cellId: 'a1' }, { kind: 'cell', cellId: 'a2' }],
    };
    expect(evaluateCellFormula(expr, 'q1', baseCtx({ q1: { a1: '1,500', a2: '3' } }))).toBe(3);
  });

  it('SUM 은 빈 셀을 0으로 취급한다', () => {
    const expr: CalcExpr = {
      kind: 'agg', fn: 'sum',
      items: [{ kind: 'cell', cellId: 'a1' }, { kind: 'cell', cellId: 'a2' }],
    };
    expect(evaluateCellFormula(expr, 'q1', baseCtx({ q1: { a1: '10' } }))).toBe(10);
  });

  it('AVG 분모는 빈 값이 아닌 항 개수 — 상수는 항상 포함', () => {
    const expr: CalcExpr = {
      kind: 'agg', fn: 'avg',
      items: [
        { kind: 'cell', cellId: 'a1' },      // '10'
        { kind: 'cell', cellId: 'a2' },      // 빈 값 → 분모 제외
        { kind: 'literal', value: 20 },      // 항상 포함
      ],
    };
    expect(evaluateCellFormula(expr, 'q1', baseCtx({ q1: { a1: '10' } }))).toBe(15);
  });

  it('AVG 전항 빈 값이면 null', () => {
    const expr: CalcExpr = { kind: 'agg', fn: 'avg', items: [{ kind: 'cell', cellId: 'a1' }] };
    expect(evaluateCellFormula(expr, 'q1', baseCtx({}))).toBeNull();
  });

  it('그룹 항의 빈 값은 0으로 취급한다', () => {
    const expr: CalcExpr = {
      kind: 'group', op: '-',
      terms: [{ kind: 'literal', value: 100 }, { kind: 'cell', cellId: 'a1' }],
    };
    expect(evaluateCellFormula(expr, 'q1', baseCtx({}))).toBe(100);
  });

  it('0으로 나누면 null', () => {
    const expr: CalcExpr = {
      kind: 'group', op: '/',
      terms: [{ kind: 'literal', value: 1 }, { kind: 'cell', cellId: 'a1' }],
    };
    expect(evaluateCellFormula(expr, 'q1', baseCtx({ q1: { a1: '0' } }))).toBeNull();
  });

  it('깨진 참조(없는 셀)는 그 항만 빈 값으로 강등된다', () => {
    const expr: CalcExpr = {
      kind: 'agg', fn: 'sum',
      items: [{ kind: 'cell', cellId: 'a1' }, { kind: 'cell', cellId: 'deleted' }],
    };
    expect(evaluateCellFormula(expr, 'q1', baseCtx({ q1: { a1: '7' } }))).toBe(7);
  });

  it('calc 셀 재참조는 재귀 평가한다 (계산 체인)', () => {
    const q = tableQuestion();
    const c1 = q.tableRowsData![0]!.cells[2]!;
    c1.formula = { kind: 'agg', fn: 'sum', items: [{ kind: 'cell', cellId: 'a1' }, { kind: 'cell', cellId: 'a2' }] };
    const expr: CalcExpr = {
      kind: 'group', op: '*',
      terms: [{ kind: 'cell', cellId: 'c1' }, { kind: 'literal', value: 2 }],
    };
    expect(evaluateCellFormula(expr, 'q1', baseCtx({ q1: { a1: '3', a2: '4' } }, [q]))).toBe(14);
  });

  it('순환 참조는 null', () => {
    const q = tableQuestion();
    const c1 = q.tableRowsData![0]!.cells[2]!;
    c1.formula = { kind: 'cell', cellId: 'c1' }; // 자기 참조
    const expr: CalcExpr = { kind: 'cell', cellId: 'c1' };
    expect(evaluateCellFormula(expr, 'q1', baseCtx({}, [q]))).toBeNull();
  });

  it('숫자형 단답 질문 참조를 읽는다', () => {
    const textQ = { id: 'q0', type: 'text', inputType: 'number', title: 'N', required: false, order: 0 } as Question;
    const expr: CalcExpr = { kind: 'question', questionId: 'q0' };
    expect(evaluateCellFormula(expr, 'q1', baseCtx({ q0: '42' }, [textQ, tableQuestion()]))).toBe(42);
  });

  it('LUT 미해결(attrs 부재)이면 수식 전체 null', () => {
    const expr: CalcExpr = {
      kind: 'group', op: '+',
      terms: [
        { kind: 'literal', value: 1 },
        { kind: 'lookup', surveyLookupId: 'lut1', keyMapping: [{ lutKey: 'k', attrsKey: 'region' }], valueColumn: 'v' },
      ],
    };
    const ctx = { ...baseCtx({}), lookups: [{ id: 'lut1', name: 'L', columns: ['k', 'v'], rows: [{ k: 'seoul', v: 10 }] }] };
    expect(evaluateCellFormula(expr, 'q1', ctx)).toBeNull();
  });

  it('LUT 해결 시 값 컬럼을 읽는다', () => {
    const expr: CalcExpr = {
      kind: 'lookup', surveyLookupId: 'lut1', keyMapping: [{ lutKey: 'k', attrsKey: 'region' }], valueColumn: 'v',
    };
    const ctx = {
      ...baseCtx({}),
      lookups: [{ id: 'lut1', name: 'L', columns: ['k', 'v'], rows: [{ k: 'seoul', v: 10 }] }],
      contactAttrs: { region: 'seoul' },
    };
    expect(evaluateCellFormula(expr, 'q1', ctx)).toBe(10);
  });

  it('결과는 decimalPlaces 인자로 반올림된다', () => {
    const expr: CalcExpr = {
      kind: 'group', op: '*',
      terms: [{ kind: 'literal', value: 0.1 }, { kind: 'literal', value: 3 }],
    };
    expect(evaluateCellFormula(expr, 'q1', baseCtx({}), 1)).toBe(0.3);
  });

  it('삭제된 LUT 참조는 항만 빈 값으로 강등된다 (전체 null 아님)', () => {
    const expr: CalcExpr = {
      kind: 'group', op: '+',
      terms: [
        { kind: 'literal', value: 7 },
        { kind: 'lookup', surveyLookupId: 'deleted-lut', keyMapping: [{ lutKey: 'k', attrsKey: 'region' }], valueColumn: 'v' },
      ],
    };
    // lookups 목록에 해당 id 가 없음 = 빌더 시점에 판명되는 깨진 참조
    expect(evaluateCellFormula(expr, 'q1', baseCtx({}))).toBe(7);
  });

  it('값 컬럼 미지정 LUT 참조도 항만 강등된다', () => {
    const expr: CalcExpr = {
      kind: 'group', op: '+',
      terms: [
        { kind: 'literal', value: 3 },
        { kind: 'lookup', surveyLookupId: 'lut1', keyMapping: [{ lutKey: 'k', attrsKey: 'region' }], valueColumn: '' },
      ],
    };
    const ctx = {
      ...baseCtx({}),
      lookups: [{ id: 'lut1', name: 'L', columns: ['k', 'v'], rows: [{ k: 'seoul', v: 10 }] }],
      contactAttrs: { region: 'seoul' },
    };
    expect(evaluateCellFormula(expr, 'q1', ctx)).toBe(3);
  });

  it('키 매핑이 비었거나 불완전한 LUT 는 빌더 미설정 — 항만 강등된다', () => {
    const lut = { id: 'lut1', name: 'L', columns: ['k', 'v'], rows: [{ k: 'seoul', v: 10 }] };
    const emptyMapping: CalcExpr = {
      kind: 'group', op: '+',
      terms: [
        { kind: 'literal', value: 5 },
        { kind: 'lookup', surveyLookupId: 'lut1', keyMapping: [], valueColumn: 'v' },
      ],
    };
    const partialMapping: CalcExpr = {
      kind: 'group', op: '+',
      terms: [
        { kind: 'literal', value: 5 },
        { kind: 'lookup', surveyLookupId: 'lut1', keyMapping: [{ lutKey: 'k', attrsKey: '' }], valueColumn: 'v' },
      ],
    };
    const ctx = { ...baseCtx({}), lookups: [lut], contactAttrs: { region: 'seoul' } };
    expect(evaluateCellFormula(emptyMapping, 'q1', ctx)).toBe(5);
    expect(evaluateCellFormula(partialMapping, 'q1', ctx)).toBe(5);
  });

  it('LUT 행 미매칭은 여전히 전체 null (런타임 미해결)', () => {
    const expr: CalcExpr = {
      kind: 'group', op: '+',
      terms: [
        { kind: 'literal', value: 1 },
        { kind: 'lookup', surveyLookupId: 'lut1', keyMapping: [{ lutKey: 'k', attrsKey: 'region' }], valueColumn: 'v' },
      ],
    };
    const ctx = {
      ...baseCtx({}),
      lookups: [{ id: 'lut1', name: 'L', columns: ['k', 'v'], rows: [{ k: 'seoul', v: 10 }] }],
      contactAttrs: { region: 'busan' }, // 행 없음
    };
    expect(evaluateCellFormula(expr, 'q1', ctx)).toBeNull();
  });

  describe('attr 항 — 컨택 attrs 참조', () => {
    const attrCtx = (contactAttrs: Record<string, string | undefined>) => ({
      ...baseCtx({}),
      contactAttrs,
    });
    const expr: CalcExpr = {
      kind: 'group', op: '+',
      terms: [{ kind: 'attr', attrsKey: '예산' }, { kind: 'literal', value: 10 }],
    };

    it('attrs 값을 숫자로 읽는다', () => {
      expect(evaluateCellFormula(expr, 'q1', attrCtx({ 예산: '90' }))).toBe(100);
    });

    it('키가 attrs 에 없으면 null — 무효 전파', () => {
      expect(evaluateCellFormula(expr, 'q1', attrCtx({}))).toBeNull();
    });

    it('빈 문자열·비숫자 값도 null — 무효 전파', () => {
      expect(evaluateCellFormula(expr, 'q1', attrCtx({ 예산: '' }))).toBeNull();
      expect(evaluateCellFormula(expr, 'q1', attrCtx({ 예산: '많음' }))).toBeNull();
      // 빌더 테스트 모드 placeholder attrs 는 '[예산]' 형태 — 비숫자로서 null
      expect(evaluateCellFormula(expr, 'q1', attrCtx({ 예산: '[예산]' }))).toBeNull();
    });

    it('attrsKey 미설정은 빌더 미완성 — 항만 강등(empty)', () => {
      const unset: CalcExpr = {
        kind: 'group', op: '+',
        terms: [{ kind: 'attr', attrsKey: '' }, { kind: 'literal', value: 10 }],
      };
      expect(evaluateCellFormula(unset, 'q1', attrCtx({}))).toBe(10);
    });

    it('상속 프로퍼티 키는 크래시 없이 null — fail-safe', () => {
      for (const key of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
        const e: CalcExpr = {
          kind: 'group', op: '+',
          terms: [{ kind: 'attr', attrsKey: key }, { kind: 'literal', value: 1 }],
        };
        expect(evaluateCellFormula(e, 'q1', attrCtx({}))).toBeNull();
      }
    });
  });
});

describe('areAllFormulaRefsEmpty', () => {
  it('literal 전용 수식은 false — 참조 항이 없으므로 비교 실행', () => {
    const expr: CalcExpr = { kind: 'literal', value: 42 };
    expect(areAllFormulaRefsEmpty(expr, 'q1', baseCtx({}))).toBe(false);
  });

  it('참조 항이 전부 빈 값이면 true', () => {
    const expr: CalcExpr = {
      kind: 'group', op: '+',
      terms: [{ kind: 'question', questionId: 'q2' }],
    };
    expect(areAllFormulaRefsEmpty(expr, 'q1', baseCtx({}))).toBe(true);
  });

  it('참조 항이 일부만 해소되면 false', () => {
    const expr: CalcExpr = {
      kind: 'group', op: '+',
      terms: [
        { kind: 'question', questionId: 'q2' },
        { kind: 'question', questionId: 'q3' },
      ],
    };
    expect(areAllFormulaRefsEmpty(expr, 'q1', baseCtx({ q2: '10' }))).toBe(false);
  });
});
