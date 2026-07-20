import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { QuestionInput } from '@/components/survey-response/question-input';
import type { NumericIssue } from '@/lib/survey/numeric-validation';
import type { Question } from '@/types/survey';

/**
 * 회귀 테스트: 표 하단 오류 배너에서 범위(range) 위반 제외.
 *
 * 범위 위반은 셀 빨간 링 + 셀 인라인 안내("* N 이상 입력해주세요")로 표시가 충분해
 * "허용 범위를 벗어난 값이 입력된 셀이 있습니다" 배너는 만들지 않는다.
 * 단, errorCellIds(빨간 링)에는 range 위반 셀도 계속 포함되어야 한다.
 */

interface CapturedProps {
  errorCellIds?: Set<string>;
  errorItems?: { message: string; cellId?: string }[];
}

const captured: CapturedProps[] = [];

vi.mock('@/components/survey-builder/interactive-table-response', () => ({
  InteractiveTableResponse: (props: CapturedProps) => {
    captured.push(props);
    return <div data-testid="table" />;
  },
}));

const tableQuestion = {
  id: 'q1',
  type: 'table',
  title: '표',
  required: false,
  order: 0,
  tableColumns: [{ id: 'col-1', label: '' }],
  tableRowsData: [
    { id: 'r1', label: '행', cells: [{ id: 'c1', type: 'input', content: '' }] },
  ],
} as unknown as Question;

function renderWithIssues(issues: NumericIssue[]) {
  captured.length = 0;
  render(
    <QuestionInput
      question={tableQuestion}
      value={{}}
      onChange={() => {}}
      allResponses={{}}
      allQuestions={[tableQuestion]}
      numericIssues={issues}
    />,
  );
  return captured[captured.length - 1]!;
}

describe('표 range 위반 배너 제외', () => {
  it('range 메시지는 배너에서 제외하고 다른 kind 메시지는 유지한다 (셀 id 목록 포함)', () => {
    const props = renderWithIssues([
      { kind: 'range', message: '허용 범위를 벗어난 값이 입력된 셀이 있습니다', cellIds: ['c1'] },
      { kind: 'required-cells', message: '필수 응답이 비어있습니다', cellIds: ['c2'] },
    ]);
    expect(props.errorItems).toEqual([{ message: '필수 응답이 비어있습니다', cellIds: ['c2'] }]);
  });

  it('range 위반 셀도 빨간 링(errorCellIds)에는 계속 포함된다', () => {
    const props = renderWithIssues([
      { kind: 'range', message: '허용 범위를 벗어난 값이 입력된 셀이 있습니다', cellIds: ['c1'] },
      { kind: 'required-cells', message: '필수 응답이 비어있습니다', cellIds: ['c2'] },
    ]);
    expect(props.errorCellIds).toEqual(new Set(['c1', 'c2']));
  });

  it('range 위반만 있으면 배너 자체가 없다 (errorItems undefined)', () => {
    const props = renderWithIssues([
      { kind: 'range', message: '허용 범위를 벗어난 값이 입력된 셀이 있습니다', cellIds: ['c1'] },
    ]);
    expect(props.errorItems).toBeUndefined();
    expect(props.errorCellIds).toEqual(new Set(['c1']));
  });
});
