import { describe, it, expect } from 'vitest';
import type {
  ExpressionConditionConfig,
  Question,
  QuestionCondition,
} from '@/types/survey';
import { emptyBranchEvalCtx } from '@/utils/branch-eval';
import { shouldDisplayQuestion } from '@/utils/branch-logic';

/**
 * 회귀 테스트: expression 표시조건의 미응답 fail-closed 정책
 *
 * 응답자 입력(cell/question operand)을 참조하는 비교가 미응답이라 평가 불가능하면
 * "아직 미충족"(false) 이어야 한다 — value-match / table-cell-check 등 legacy 조건
 * 타입과 동일 정책(branch-logic evaluateQuestionCondition 의 fail-closed).
 *
 * 과거에는 미해결 비교가 무조건 true(fail-safe SHOW)라서:
 * - 아무것도 입력하지 않아도 조건부 질문이 전부 표시되고
 * - (연도==2024 AND 월==8) 에서 월 미입력 시 월 절이 true 로 퇴화해
 *   연도만 맞으면 AND 가 통과했다 (실제 설문 B4 사례).
 *
 * 환경 미주입(lookup/attr) 만으로 미해결인 비교는 기존 fail-safe SHOW 를 유지한다
 * (ctx 미주입 빌더 미리보기에서 질문이 사라지지 않도록).
 */

// 졸업 연월 소스 표 (B3 미러): 연도/월 input 셀
function makeSourceQuestion(): Question {
  return {
    id: 'q-grad',
    surveyId: 's1',
    type: 'table',
    title: '졸업 연월',
    required: false,
    order: 0,
    tableColumns: [{ id: 'col-1', label: '값' }],
    tableRowsData: [
      {
        id: 'row-1',
        label: '졸업',
        cells: [
          { id: 'cell-year', content: '', type: 'input' as const, inputType: 'number' as const },
          { id: 'cell-month', content: '', type: 'input' as const, inputType: 'number' as const },
        ],
      },
    ],
  } as unknown as Question;
}

function cellEq(cellId: string, value: number) {
  return {
    kind: 'comparison' as const,
    comparison: {
      op: '==' as const,
      left: { kind: 'cell' as const, cellId, questionId: 'q-grad' },
      right: { kind: 'literal' as const, value },
    },
  };
}

// (연도==year AND 월==month) expression 조건 하나
function yearMonthCondition(id: string, year: number, month: number): QuestionCondition {
  return {
    id,
    sourceQuestionId: 'q-grad',
    conditionType: 'expression',
    logicType: 'AND',
    enabled: true,
    expressionConfig: {
      clauses: [cellEq('cell-year', year), cellEq('cell-month', month)],
      joinOps: ['AND'],
    } as ExpressionConditionConfig,
  } as QuestionCondition;
}

// B4 미러: (2024 AND 8) OR (2025 AND 2)
function makeTargetQuestion(): Question {
  return {
    id: 'q-b4',
    surveyId: 's1',
    type: 'radio',
    title: 'B4',
    required: false,
    order: 1,
    displayCondition: {
      logicType: 'OR',
      conditions: [
        yearMonthCondition('c-2024-8', 2024, 8),
        yearMonthCondition('c-2025-2', 2025, 2),
      ],
    },
  } as unknown as Question;
}

function display(responses: Record<string, unknown>): boolean {
  const target = makeTargetQuestion();
  return shouldDisplayQuestion(target, responses, [makeSourceQuestion(), target]);
}

describe('expression 표시조건 — 미응답 fail-closed (B4 시나리오)', () => {
  it('아무 응답도 없으면 숨긴다', () => {
    expect(display({})).toBe(false);
  });

  it('연도만 일치하고 월 미입력이면 AND 미충족 — 숨긴다', () => {
    expect(display({ 'q-grad': { 'cell-year': '2024' } })).toBe(false);
  });

  it('연도 일치 + 월 불일치면 숨긴다', () => {
    expect(display({ 'q-grad': { 'cell-year': '2024', 'cell-month': '2' } })).toBe(false);
  });

  it('연도+월 모두 일치하면 표시한다 (첫 OR 그룹)', () => {
    expect(display({ 'q-grad': { 'cell-year': '2024', 'cell-month': '8' } })).toBe(true);
  });

  it('두 번째 OR 그룹(2025.2) 일치도 표시한다', () => {
    expect(display({ 'q-grad': { 'cell-year': '2025', 'cell-month': '2' } })).toBe(true);
  });
});

describe('expression 표시조건 — 환경(attr) 미해결은 기존 fail-safe SHOW 유지', () => {
  it('attr operand 미주입이면 표시한다', () => {
    const condition: QuestionCondition = {
      id: 'c-attr',
      sourceQuestionId: 'q-grad',
      conditionType: 'expression',
      logicType: 'AND',
      enabled: true,
      expressionConfig: {
        clauses: [
          {
            kind: 'comparison',
            comparison: {
              op: '==',
              left: { kind: 'attr', attrsKey: '전시회' },
              right: { kind: 'literal', value: 'A전시회' },
            },
          },
        ],
        joinOps: [],
      } as ExpressionConditionConfig,
    } as QuestionCondition;
    const target = {
      ...makeTargetQuestion(),
      displayCondition: { logicType: 'AND', conditions: [condition] },
    } as Question;

    // ctx 미주입(contactAttrs 없음) — 익명 진입/빌더 미리보기 시나리오
    expect(
      shouldDisplayQuestion(target, {}, [makeSourceQuestion(), target], undefined, emptyBranchEvalCtx()),
    ).toBe(true);
  });
});
