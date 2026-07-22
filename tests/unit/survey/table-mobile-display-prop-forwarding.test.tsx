import type { ReactNode } from 'react';

import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QuestionTestBody } from '@/components/survey-builder/question-test-card';
import { QuestionInput } from '@/components/survey-response/question-input';
import { useTestResponseStore } from '@/stores/test-response-store';
import type { Question } from '@/types/survey';

const { capturedTableProps } = vi.hoisted(() => ({
  capturedTableProps: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/components/survey-builder/interactive-table-response', () => ({
  InteractiveTableResponse: (props: Record<string, unknown>) => {
    capturedTableProps.push(props);
    return <div data-testid="interactive-table-response" />;
  },
}));

vi.mock('@/components/survey-builder/sortable-question-list', () => ({
  LazyMount: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/use-row-heights', () => ({
  computeTableEstimatedHeight: () => 320,
}));

const tableQuestion = {
  id: 'table-question',
  type: 'table',
  title: '테이블',
  required: false,
  order: 0,
  tableColumns: [
    { id: 'label', label: '항목' },
    { id: 'value', label: '선택' },
  ],
  tableRowsData: [
    {
      id: 'row-1',
      label: '항목 1',
      cells: [
        { id: 'label-cell', type: 'text', content: '항목 1' },
        {
          id: 'value-cell',
          type: 'radio',
          content: '',
          radioOptions: [{ id: 'yes', label: '예', value: 'yes' }],
        },
      ],
    },
  ],
  mobileOriginalTable: true,
  mobileTableDisplayMode: 'drilldown-original-row',
  mobileDrilldownOmitLeadingColumns: 2,
  mobileDrilldownRepeatHeaderStartRow: 0,
  mobileDrilldownRepeatHeaderEndRow: 2,
} as unknown as Question;

function lastCapturedProps(): Record<string, unknown> {
  const props = capturedTableProps.at(-1);
  if (!props) throw new Error('InteractiveTableResponse props가 캡처되지 않았습니다.');
  return props;
}

describe('모바일 테이블 표시 설정 prop 전달', () => {
  beforeEach(() => {
    capturedTableProps.length = 0;
    useTestResponseStore.getState().clearTestResponses();
  });

  it('공개 QuestionInput이 canonical 두 필드와 legacy boolean을 전달한다', () => {
    render(
      <QuestionInput
        question={tableQuestion}
        value={{}}
        onChange={() => {}}
        allResponses={{}}
        allQuestions={[tableQuestion]}
      />,
    );

    expect(lastCapturedProps()).toMatchObject({
      mobileOriginalTable: true,
      mobileTableDisplayMode: 'drilldown-original-row',
      mobileDrilldownOmitLeadingColumns: 2,
      mobileDrilldownRepeatHeaderStartRow: 0,
      mobileDrilldownRepeatHeaderEndRow: 2,
      isTestMode: false,
    });
  });

  it('빌더 QuestionTestBody가 canonical 두 필드와 legacy boolean을 전달한다', () => {
    render(<QuestionTestBody question={tableQuestion} />);

    expect(lastCapturedProps()).toMatchObject({
      mobileOriginalTable: true,
      mobileTableDisplayMode: 'drilldown-original-row',
      mobileDrilldownOmitLeadingColumns: 2,
      mobileDrilldownRepeatHeaderStartRow: 0,
      mobileDrilldownRepeatHeaderEndRow: 2,
      isTestMode: true,
    });
  });
});
