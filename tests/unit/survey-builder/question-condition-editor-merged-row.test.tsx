import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { QuestionConditionEditor } from '@/components/survey-builder/question-condition-editor';
import { shouldDisplayQuestion } from '@/utils/branch-logic';
import type { Question, QuestionConditionGroup } from '@/types/survey';

/**
 * 회귀: 병합 행(rowspan) 대상 table-cell-check 조건의 `all` 이 영원히 충족되지 않던 버그.
 *
 * 원인 — `toggleRowId`(question-condition-editor.tsx)가 앵커 셀을 클릭해도 병합 범위
 * 전체(앵커 + 연속 행)를 `tableConditions.rowIds` 에 저장했다. 런타임 평가
 * (table-cell-semantics 의 `isEvaluableCell`)는 `isHidden` 셀을 항상 건너뛰므로 연속 행은
 * 절대 매칭될 수 없고, `all` 은 `targetRowIds.every(matchedRowIds.includes)` 라서 연속 행
 * id 가 하나라도 rowIds 에 섞이면 조건이 불충족으로 고정된다.
 *
 * 수정 — 저장 시점에 앵커 행 id 하나만 남긴다(`getMergedRowIds` 의 0번 요소가 항상 앵커).
 * 연속 행은 UI 에서도 체크박스가 disabled 라 독립적으로 선택될 수 없으므로 정보 손실이 없다.
 */

function mergedSourceQuestion(): Question {
  return {
    id: 'q-src',
    surveyId: 's1',
    type: 'table',
    title: '병합 표',
    required: false,
    order: 0,
    tableColumns: [{ id: 'col-0', label: '체크' }],
    tableRowsData: [
      {
        id: 'row-1',
        label: '앵커 행',
        cells: [
          {
            id: 'r1-c0',
            content: '',
            type: 'checkbox',
            rowspan: 3,
            checkboxOptions: [{ id: 'opt-a', label: 'A', value: 'A' }],
          },
        ],
      },
      {
        id: 'row-2',
        label: '연속 행 1',
        cells: [
          {
            id: 'r2-c0',
            content: '',
            type: 'checkbox',
            isHidden: true,
            checkboxOptions: [{ id: 'opt-a', label: 'A', value: 'A' }],
          },
        ],
      },
      {
        id: 'row-3',
        label: '연속 행 2',
        cells: [
          {
            id: 'r3-c0',
            content: '',
            type: 'checkbox',
            isHidden: true,
            checkboxOptions: [{ id: 'opt-a', label: 'A', value: 'A' }],
          },
        ],
      },
    ],
  } as unknown as Question;
}

function targetQuestion(): Question {
  return {
    id: 'q-target',
    surveyId: 's1',
    type: 'text',
    title: '하위 질문',
    required: false,
    order: 1,
  } as unknown as Question;
}

/** condition-card 의 table-cell-check 편집 화면을 곧바로 펼쳐 렌더한다. */
function renderEditor(checkType: 'any' | 'all' | 'none', onUpdate: (g: QuestionConditionGroup | undefined) => void) {
  const source = mergedSourceQuestion();
  const target = targetQuestion();
  const initialCondition: QuestionConditionGroup = {
    logicType: 'AND',
    conditions: [
      {
        id: 'c1',
        enabled: true,
        logicType: 'AND',
        conditionType: 'table-cell-check',
        sourceQuestionId: source.id,
        tableConditions: { rowIds: [], checkType, cellColumnIndex: 0 },
      },
    ],
  };
  render(
    <QuestionConditionEditor
      question={target}
      allQuestions={[source, target]}
      onUpdate={onUpdate}
      initialCondition={initialCondition}
    />,
  );
  return { source, target };
}

describe('question-condition-editor — 병합 행 앵커 클릭', () => {
  it('앵커 행 체크박스를 클릭하면 앵커 id 만 저장한다 (연속 행 id 는 섞이지 않는다)', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    renderEditor('all', onUpdate);

    await user.click(screen.getByText('상세 설정 펼치기'));
    const anchorCheckbox = await screen.findByLabelText(/앵커 행/);
    await user.click(anchorCheckbox);

    const lastCall = onUpdate.mock.calls.at(-1)?.[0] as QuestionConditionGroup | undefined;
    const rowIds = lastCall?.conditions[0]?.tableConditions?.rowIds;
    expect(rowIds).toEqual(['row-1']);
  });

  it('연속 행 체크박스는 비활성화되어 있어 독립적으로 선택할 수 없다', async () => {
    const onUpdate = vi.fn();
    renderEditor('all', onUpdate);
    await userEvent.setup().click(screen.getByText('상세 설정 펼치기'));

    const continuation1 = await screen.findByLabelText(/연속 행 1/);
    const continuation2 = screen.getByLabelText(/연속 행 2/);
    expect(continuation1).toBeDisabled();
    expect(continuation2).toBeDisabled();
  });
});

describe('table-cell-check 런타임 평가 — 앵커 전용 저장 형태', () => {
  const source = mergedSourceQuestion();
  const target = targetQuestion();

  function withCondition(checkType: 'any' | 'all' | 'none'): Question {
    return {
      ...target,
      displayCondition: {
        logicType: 'AND',
        conditions: [
          {
            id: 'c1',
            enabled: true,
            logicType: 'AND',
            conditionType: 'table-cell-check',
            sourceQuestionId: source.id,
            tableConditions: { rowIds: ['row-1'], cellColumnIndex: 0, checkType },
          },
        ],
      },
    } as Question;
  }

  // 표 응답은 질문 id 아래 { 셀id: 값 } 으로 중첩 저장된다 — 평탄한 { 셀id: 값 } 이 아니다.
  const checked = { [source.id]: { 'r1-c0': ['A'] } };
  const unchecked = { [source.id]: {} };

  it('all — 앵커 셀이 체크되면 충족된다', () => {
    const q = withCondition('all');
    expect(shouldDisplayQuestion(q, checked, [source, q], [])).toBe(true);
  });

  it('all — 앵커 셀이 체크되지 않으면 미충족이다', () => {
    const q = withCondition('all');
    expect(shouldDisplayQuestion(q, unchecked, [source, q], [])).toBe(false);
  });

  it('any — 앵커 셀이 체크되면 충족된다', () => {
    const q = withCondition('any');
    expect(shouldDisplayQuestion(q, checked, [source, q], [])).toBe(true);
  });

  it('any — 앵커 셀이 체크되지 않으면 미충족이다', () => {
    const q = withCondition('any');
    expect(shouldDisplayQuestion(q, unchecked, [source, q], [])).toBe(false);
  });

  it('none — 앵커 셀이 체크되지 않으면 충족된다', () => {
    const q = withCondition('none');
    expect(shouldDisplayQuestion(q, unchecked, [source, q], [])).toBe(true);
  });

  it('none — 앵커 셀이 체크되면 미충족이다', () => {
    const q = withCondition('none');
    expect(shouldDisplayQuestion(q, checked, [source, q], [])).toBe(false);
  });

  it('알려진 잔여 한계 — 수정 전 저장 형태(연속 행 id 포함)는 재저장 전까지 여전히 깨져 있다', () => {
    // 이 테스트는 고쳐진 동작이 아니라 고쳐지지 않는 범위를 고정한다. 수정은 편집기의
    // 저장 시점(toggleRowId)에서만 일어난다 — 이미 발행돼 연속 행 id 까지 섞여 저장된
    // 조건은 담당자가 그 행을 한 번 더 토글해 다시 저장하기 전까지 이 값 그대로 남는다.
    const q = {
      ...target,
      displayCondition: {
        logicType: 'AND',
        conditions: [
          {
            id: 'c1',
            enabled: true,
            logicType: 'AND',
            conditionType: 'table-cell-check',
            sourceQuestionId: source.id,
            tableConditions: {
              rowIds: ['row-1', 'row-2', 'row-3'],
              cellColumnIndex: 0,
              checkType: 'all',
            },
          },
        ],
      },
    } as Question;
    // 수정 전에는 이 assertion 이 false 를 받아 실패했다 — 연속 행이 절대 매칭되지 않아서다.
    expect(shouldDisplayQuestion(q, checked, [source, q], [])).toBe(false);
  });
});
