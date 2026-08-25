import { describe, it, expect } from 'vitest';
import type {
  ExpressionConditionConfig,
  Question,
  QuestionCondition,
} from '@/types/survey';
import { shouldDisplayQuestion } from '@/utils/branch-logic';

// 헬퍼: source 질문 (table) 생성 — 셀 응답값을 evaluator 가 추출
function makeTableQuestion(): Question {
  return {
    id: 'q-table',
    surveyId: 's1',
    type: 'table',
    title: '비용표',
    required: false,
    order: 0,
    tableColumns: [
      { id: 'col-label', label: '항목' },
      { id: 'col-amount', label: '금액' },
    ],
    tableRowsData: [
      {
        id: 'row-출장비',
        label: '출장비',
        cells: [
          { id: 'cell-lbl-1', content: '출장비', type: 'text' as const },
          {
            id: 'cell-출장비',
            content: '',
            type: 'input' as const,
            inputType: 'number' as const,
          },
        ],
      },
      {
        id: 'row-인원',
        label: '인원',
        cells: [
          { id: 'cell-lbl-2', content: '인원', type: 'text' as const },
          {
            id: 'cell-인원',
            content: '',
            type: 'input' as const,
            inputType: 'number' as const,
          },
        ],
      },
    ],
  } as unknown as Question;
}

function makeTargetQuestion(expressionConfig: ExpressionConditionConfig): Question {
  const condition: QuestionCondition = {
    id: 'c1',
    sourceQuestionId: 'q-table',
    conditionType: 'expression',
    logicType: 'AND',
    enabled: true,
    expressionConfig,
  };
  return {
    id: 'q-target',
    surveyId: 's1',
    type: 'text',
    title: '타겟',
    required: false,
    order: 1,
    displayCondition: { conditions: [condition], logicType: 'AND' },
  } as unknown as Question;
}

function makeResponses(amountValue: number, peopleValue: number) {
  // 실제 응답 저장 구조: question_responses[questionId] = { cellId: value } (평면)
  // checkTableCellCondition 등 다른 evaluator 가 사용하는 구조와 동일
  return {
    'q-table': {
      'cell-출장비': String(amountValue),
      'cell-인원': String(peopleValue),
    },
  };
}

describe('expression conditionType — evaluator', () => {
  it('literal == literal → true', () => {
    const config: ExpressionConditionConfig = {
      clauses: [{
        kind: 'comparison',
        comparison: {
          left: { kind: 'literal', value: 5 },
          op: '==',
          right: { kind: 'literal', value: 5 },
        },
      }],
      joinOps: [],
    };
    const target = makeTargetQuestion(config);
    expect(shouldDisplayQuestion(target, {}, [makeTableQuestion(), target])).toBe(true);
  });

  it('cell ÷ cell ≤ literal — 출장비/인원 ≤ 100만원, 만족', () => {
    const config: ExpressionConditionConfig = {
      clauses: [{
        kind: 'comparison',
        comparison: {
          left: {
            kind: 'binop', op: '/',
            left:  { kind: 'cell', questionId: 'q-table', cellId: 'cell-출장비' },
            right: { kind: 'cell', questionId: 'q-table', cellId: 'cell-인원' },
          },
          op: '<=',
          right: { kind: 'literal', value: 1000000 },
        },
      }],
      joinOps: [],
    };
    const target = makeTargetQuestion(config);
    const responses = makeResponses(900000, 1); // 900000/1 = 900000 ≤ 1000000 → true
    expect(shouldDisplayQuestion(target, responses, [makeTableQuestion(), target])).toBe(true);
  });

  it('cell ÷ cell ≤ literal — 출장비/인원 ≤ 100만원, 불만족', () => {
    const config: ExpressionConditionConfig = {
      clauses: [{
        kind: 'comparison',
        comparison: {
          left: {
            kind: 'binop', op: '/',
            left:  { kind: 'cell', questionId: 'q-table', cellId: 'cell-출장비' },
            right: { kind: 'cell', questionId: 'q-table', cellId: 'cell-인원' },
          },
          op: '<=',
          right: { kind: 'literal', value: 1000000 },
        },
      }],
      joinOps: [],
    };
    const target = makeTargetQuestion(config);
    const responses = makeResponses(3000000, 1); // 3000000 > 1000000 → false
    expect(shouldDisplayQuestion(target, responses, [makeTableQuestion(), target])).toBe(false);
  });

  // 응답자 입력(cell) 기반 비교가 평가 불가능하면 fail-closed (2026-07-16 정책 변경 —
  // 미응답/평가불능 시 표시조건 미충족. expression-unanswered-fail-closed.test.ts 참조)
  it('binop with /0 → undefined → 응답 기반이므로 fail-closed (false)', () => {
    const config: ExpressionConditionConfig = {
      clauses: [{
        kind: 'comparison',
        comparison: {
          left: {
            kind: 'binop', op: '/',
            left:  { kind: 'cell', questionId: 'q-table', cellId: 'cell-출장비' },
            right: { kind: 'cell', questionId: 'q-table', cellId: 'cell-인원' },
          },
          op: '<=',
          right: { kind: 'literal', value: 100 },
        },
      }],
      joinOps: [],
    };
    const target = makeTargetQuestion(config);
    const responses = makeResponses(500, 0); // 500/0 = undefined → 미충족
    expect(shouldDisplayQuestion(target, responses, [makeTableQuestion(), target])).toBe(false);
  });

  it('AND clause 조합 — 둘 다 만족', () => {
    const config: ExpressionConditionConfig = {
      clauses: [
        {
          kind: 'comparison',
          comparison: {
            left: { kind: 'cell', questionId: 'q-table', cellId: 'cell-출장비' },
            op: '>',
            right: { kind: 'literal', value: 100 },
          },
        },
        {
          kind: 'comparison',
          comparison: {
            left: { kind: 'cell', questionId: 'q-table', cellId: 'cell-인원' },
            op: '>',
            right: { kind: 'literal', value: 0 },
          },
        },
      ],
      joinOps: ['AND'],
    };
    const target = makeTargetQuestion(config);
    const responses = makeResponses(500, 2);
    expect(shouldDisplayQuestion(target, responses, [makeTableQuestion(), target])).toBe(true);
  });

  it('AND clause 조합 — 한쪽 불만족', () => {
    const config: ExpressionConditionConfig = {
      clauses: [
        {
          kind: 'comparison',
          comparison: {
            left: { kind: 'cell', questionId: 'q-table', cellId: 'cell-출장비' },
            op: '>',
            right: { kind: 'literal', value: 1000 },
          },
        },
        {
          kind: 'comparison',
          comparison: {
            left: { kind: 'cell', questionId: 'q-table', cellId: 'cell-인원' },
            op: '>',
            right: { kind: 'literal', value: 0 },
          },
        },
      ],
      joinOps: ['AND'],
    };
    const target = makeTargetQuestion(config);
    const responses = makeResponses(500, 2); // 500 > 1000 false → false
    expect(shouldDisplayQuestion(target, responses, [makeTableQuestion(), target])).toBe(false);
  });

  it('OR clause 조합 — 하나 만족', () => {
    const config: ExpressionConditionConfig = {
      clauses: [
        {
          kind: 'comparison',
          comparison: {
            left: { kind: 'cell', questionId: 'q-table', cellId: 'cell-출장비' },
            op: '>',
            right: { kind: 'literal', value: 1000 },
          },
        },
        {
          kind: 'comparison',
          comparison: {
            left: { kind: 'cell', questionId: 'q-table', cellId: 'cell-인원' },
            op: '>=',
            right: { kind: 'literal', value: 1 },
          },
        },
      ],
      joinOps: ['OR'],
    };
    const target = makeTargetQuestion(config);
    const responses = makeResponses(500, 2); // 500>1000 false || 2>=1 true → true
    expect(shouldDisplayQuestion(target, responses, [makeTableQuestion(), target])).toBe(true);
  });

  // 헬퍼: 항상 true/false 인 literal comparison clause (혼합 AND/OR 좌결합 검증용)
  function boolClause(value: boolean) {
    return {
      kind: 'comparison' as const,
      comparison: {
        left: { kind: 'literal' as const, value: 1 },
        op: '==' as const,
        right: { kind: 'literal' as const, value: value ? 1 : 0 },
      },
    };
  }

  // 혼합 AND/OR 은 연산자 우선순위 없이 좌결합 폴드로 평가돼야 한다.
  // 단락 평가 break 가 있으면 뒤 절을 폐기해 결과가 뒤집힌다.
  it('혼합 AND/OR — true OR true AND false = ((T||T)&&F) = false', () => {
    const config: ExpressionConditionConfig = {
      clauses: [boolClause(true), boolClause(true), boolClause(false)],
      joinOps: ['OR', 'AND'],
    };
    const target = makeTargetQuestion(config);
    expect(shouldDisplayQuestion(target, {}, [makeTableQuestion(), target])).toBe(false);
  });

  it('혼합 AND/OR — false AND false OR true = ((F&&F)||T) = true', () => {
    const config: ExpressionConditionConfig = {
      clauses: [boolClause(false), boolClause(false), boolClause(true)],
      joinOps: ['AND', 'OR'],
    };
    const target = makeTargetQuestion(config);
    expect(shouldDisplayQuestion(target, {}, [makeTableQuestion(), target])).toBe(true);
  });

  it('혼합 AND/OR — true OR false AND true = ((T||F)&&T) = true', () => {
    const config: ExpressionConditionConfig = {
      clauses: [boolClause(true), boolClause(false), boolClause(true)],
      joinOps: ['OR', 'AND'],
    };
    const target = makeTargetQuestion(config);
    expect(shouldDisplayQuestion(target, {}, [makeTableQuestion(), target])).toBe(true);
  });

  it('group 안의 clause 평가', () => {
    const config: ExpressionConditionConfig = {
      clauses: [{
        kind: 'group',
        group: {
          clauses: [{
            kind: 'comparison',
            comparison: {
              left: { kind: 'cell', questionId: 'q-table', cellId: 'cell-출장비' },
              op: '>',
              right: { kind: 'literal', value: 100 },
            },
          }],
          joinOps: [],
        },
      }],
      joinOps: [],
    };
    const target = makeTargetQuestion(config);
    expect(shouldDisplayQuestion(target, makeResponses(500, 1), [makeTableQuestion(), target])).toBe(true);
  });

  it('빈 clauses → true (fail-safe SHOW)', () => {
    const config: ExpressionConditionConfig = { clauses: [], joinOps: [] };
    const target = makeTargetQuestion(config);
    expect(shouldDisplayQuestion(target, {}, [makeTableQuestion(), target])).toBe(true);
  });

  // 미응답 cell operand 는 "아직 미충족" — legacy 조건 타입과 동일한 fail-closed
  it('응답 부재 → undefined cell operand → 숨김 (fail-closed)', () => {
    const config: ExpressionConditionConfig = {
      clauses: [{
        kind: 'comparison',
        comparison: {
          left: { kind: 'cell', questionId: 'q-table', cellId: 'cell-출장비' },
          op: '>',
          right: { kind: 'literal', value: 0 },
        },
      }],
      joinOps: [],
    };
    const target = makeTargetQuestion(config);
    expect(shouldDisplayQuestion(target, {}, [makeTableQuestion(), target])).toBe(false);
  });
});
