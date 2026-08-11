import { describe, expect, it } from 'vitest';
import { collectFormulaDiagnostics } from '@/lib/survey/cell-formula-diagnostics';
import type { Question, QuestionGroup } from '@/types/survey';

// 최소 표 질문 헬퍼 — 숫자 input(num) + 텍스트 input(txt) + calc(c) 셀, calc 의 formula 는
// 인자로 받은 셀 참조를 가리킨다. Task 2 의 tableQuestion 헬퍼 패턴을 복제(테스트 파일 간
// import 공유하지 않는 tests/unit 관례).
function calcQuestion(order: number, id: string, formulaCellRef: { questionId?: string; cellId: string }): Question {
  return {
    id, type: 'table', title: id, required: false, order,
    tableRowsData: [{
      id: 'r1', label: 'r1',
      cells: [
        { id: `${id}-num`, content: '', type: 'input', inputType: 'number' },
        { id: `${id}-txt`, content: '', type: 'input' },
        { id: `${id}-c`, content: '', type: 'calc', formula: { kind: 'cell', ...formulaCellRef } },
      ],
    }],
  } as Question;
}

describe('collectFormulaDiagnostics', () => {
  it('정상 수식은 무경고', () => {
    const q = calcQuestion(1, 'q1', { cellId: 'q1-num' });
    expect(collectFormulaDiagnostics([q], [], [])).toEqual([]);
  });

  it('없는 셀 참조는 broken-ref', () => {
    const q = calcQuestion(1, 'q1', { cellId: 'nope' });
    expect(collectFormulaDiagnostics([q], [], []).map((d) => d.kind)).toContain('broken-ref');
  });

  it('숫자 아닌 셀 참조는 non-numeric-ref', () => {
    const q = calcQuestion(1, 'q1', { cellId: 'q1-txt' });
    expect(collectFormulaDiagnostics([q], [], []).map((d) => d.kind)).toContain('non-numeric-ref');
  });

  it('calc 자기 참조는 cycle', () => {
    const q = calcQuestion(1, 'q1', { cellId: 'q1-c' });
    expect(collectFormulaDiagnostics([q], [], []).map((d) => d.kind)).toContain('cycle');
  });

  it('검증 셀이 뒤 순서 질문을 참조하면 validation-backward-ref', () => {
    const q1 = calcQuestion(1, 'q1', { cellId: 'q1-num' });
    const later = calcQuestion(2, 'q2', { cellId: 'q2-num' });
    const validationCell = q1.tableRowsData![0]!.cells[0]!;
    validationCell.formula = { kind: 'cell', questionId: 'q2', cellId: 'q2-num' };
    expect(collectFormulaDiagnostics([q1, later], [], []).map((d) => d.kind)).toContain('validation-backward-ref');
  });

  // ── branch-same-group-calc ──
  //
  // "같은 페이지"는 groupId 근사가 아니라 buildRenderSteps(questions, groups) 실제 페이지
  // 분할(수동 pageBreakBefore 구분점 모델)로 판정한다 — src/lib/group-ordering.ts 참조.
  // groups 는 필수 인자다 — 그룹 정보가 없는 호출은 `[]` 를 명시적으로 넘겨야 하며, 그 경우
  // 이 진단은 조용히 스킵된다(오탐 방지가 최우선 — 그룹 정보 없이는 페이지를 알 수 없다).

  function displayConditionQuestion(
    order: number,
    id: string,
    groupId: string,
    ref: { questionId: string; cellId: string },
  ): Question {
    return {
      id, type: 'text', title: id, required: false, order, groupId,
      displayCondition: {
        logicType: 'AND',
        conditions: [{
          id: 'cond1',
          sourceQuestionId: ref.questionId,
          conditionType: 'table-cell-check',
          logicType: 'AND',
          tableConditions: {
            rowIds: [],
            checkType: 'any',
            numericComparison: {
              operator: '>',
              left: { kind: 'cell', questionId: ref.questionId, cellId: ref.cellId },
              right: { kind: 'literal', value: 0 },
            },
          },
        }],
      },
    } as Question;
  }

  it('분기 조건이 같은 페이지의 calc 셀을 참조하면 branch-same-group-calc', () => {
    const calcQ = calcQuestion(1, 'q1', { cellId: 'q1-num' }); // q1-c 는 정상 calc 셀
    const branchQ = displayConditionQuestion(2, 'q2', 'g1', { questionId: 'q1', cellId: 'q1-c' });
    calcQ.groupId = 'g1';
    const group: QuestionGroup = { id: 'g1', surveyId: 's1', name: '그룹1', order: 0 };
    const kinds = collectFormulaDiagnostics([calcQ, branchQ], [], [group]).map((d) => d.kind);
    expect(kinds).toContain('branch-same-group-calc');
  });

  it('분기 조건이 앞 페이지의 calc 셀을 참조하면 무경고 (pageBreakBefore 로 페이지 분리)', () => {
    const calcQ = calcQuestion(1, 'q1', { cellId: 'q1-num' });
    calcQ.groupId = 'g1';
    const branchQ = displayConditionQuestion(2, 'q2', 'g1', { questionId: 'q1', cellId: 'q1-c' });
    branchQ.pageBreakBefore = true; // q2 는 q1 과 다른 페이지에서 시작
    const group: QuestionGroup = { id: 'g1', surveyId: 's1', name: '그룹1', order: 0 };
    const kinds = collectFormulaDiagnostics([calcQ, branchQ], [], [group]).map((d) => d.kind);
    expect(kinds).not.toContain('branch-same-group-calc');
  });

  it('groups 를 빈 배열로 넘기면 branch-same-group-calc 는 스킵된다 (오탐 방지)', () => {
    const calcQ = calcQuestion(1, 'q1', { cellId: 'q1-num' });
    calcQ.groupId = 'g1';
    const branchQ = displayConditionQuestion(2, 'q2', 'g1', { questionId: 'q1', cellId: 'q1-c' });
    const kinds = collectFormulaDiagnostics([calcQ, branchQ], [], []).map((d) => d.kind);
    expect(kinds).not.toContain('branch-same-group-calc');
  });
});
