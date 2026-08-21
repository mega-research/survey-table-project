import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { InteractiveTableResponse } from '@/features/question-renderer/interactive-table-response';
import { useTestResponseStore } from '@/features/question-renderer/stores/test-response-store';

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => true,
  useMediaQuery: () => true,
}));
vi.mock('@/lib/survey/contact-attrs-context', () => ({
  useContactAttrs: () => ({}),
  useAnswerQuotes: () => ({}),
}));

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

const columns = [
  { id: 'label', label: '문항', width: 160 },
  { id: 'answer', label: '응답', width: 260 },
];
const rows = [
  {
    id: 'row-1',
    label: '첫 문항',
    cells: [
      { id: 'label-1', type: 'text', content: '첫 문항' },
      { id: 'answer-1', type: 'input', content: '', placeholder: '첫 응답' },
    ],
  },
  {
    id: 'row-2',
    label: '둘째 문항',
    cells: [
      { id: 'label-2', type: 'text', content: '둘째 문항' },
      { id: 'answer-2', type: 'input', content: '', placeholder: '둘째 응답' },
    ],
  },
];

describe('InteractiveTableResponse row-wise-original', () => {
  it('모든 응답 행을 한 화면에 나열하고 기존 cell.id 응답 객체로 기록한다', () => {
    const onChange = vi.fn();
    render(
      <InteractiveTableResponse
        questionId="table-question"
        columns={columns as never}
        rows={rows as never}
        mobileTableDisplayMode="row-wise-original"
        mobileDrilldownOmitLeadingColumns={1}
        value={{}}
        onChange={onChange}
      />,
    );

    expect(screen.getByTestId('mobile-row-wise-original-sheet')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '첫 문항' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '둘째 문항' })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('둘째 응답'), {
      target: { value: '응답값' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ 'answer-2': '응답값' });
  });

  it('검증 뒤 실제 오류 입력과 해당 행 제목에만 오류 상태를 연결한다', () => {
    render(
      <InteractiveTableResponse
        questionId="table-question"
        columns={columns as never}
        rows={rows as never}
        mobileTableDisplayMode="row-wise-original"
        mobileDrilldownOmitLeadingColumns={1}
        value={{}}
        onChange={vi.fn()}
        errorCellIds={new Set(['answer-2'])}
      />,
    );

    expect(screen.getByPlaceholderText('첫 응답')).not.toHaveAttribute('aria-invalid', 'true');
    const invalidInput = screen.getByPlaceholderText('둘째 응답');
    expect(invalidInput).toHaveAttribute('aria-invalid', 'true');
    expect(invalidInput).toHaveAttribute('id', 'row-2-answer-2');
    const errorDescriptionId = invalidInput.getAttribute('aria-describedby');
    expect(errorDescriptionId).toBeTruthy();
    expect(document.getElementById(errorDescriptionId!)).toHaveTextContent(
      '둘째 문항의 응답을 확인해 주세요.',
    );
    expect(screen.getByText('첫 문항')).not.toHaveClass('text-red-700');
    expect(screen.getByText('둘째 문항')).toHaveClass('text-red-700');
  });

  it('빌더 테스트 모드에서는 같은 셀 응답을 테스트 응답 store에 기록한다', () => {
    useTestResponseStore.getState().clearTestResponses();
    render(
      <InteractiveTableResponse
        questionId="table-test-question"
        columns={columns as never}
        rows={rows as never}
        mobileTableDisplayMode="row-wise-original"
        mobileDrilldownOmitLeadingColumns={1}
        isTestMode
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('첫 응답'), {
      target: { value: '테스트 값' },
    });
    expect(useTestResponseStore.getState().testResponses['table-test-question']).toEqual({
      'answer-1': '테스트 값',
    });
  });

  it('한 행의 여러 선택 셀이 같은 option id를 사용해도 입력 id를 고유하게 만든다', () => {
    render(
      <InteractiveTableResponse
        questionId="choice-cell-table"
        columns={[
          { id: 'label', label: '문항' },
          { id: 'answer-a', label: 'A' },
          { id: 'answer-b', label: 'B' },
        ] as never}
        rows={[
          {
            id: 'row-1',
            label: '선택 문항',
            cells: [
              { id: 'label-1', type: 'text', content: '선택 문항' },
              {
                id: 'radio-a',
                type: 'radio',
                content: '',
                radioOptions: [{ id: 'yes', label: 'A 선택', value: 'yes' }],
              },
              {
                id: 'radio-b',
                type: 'radio',
                content: '',
                radioOptions: [{ id: 'yes', label: 'B 선택', value: 'yes' }],
              },
            ],
          },
        ] as never}
        mobileTableDisplayMode="row-wise-original"
        mobileDrilldownOmitLeadingColumns={1}
        value={{}}
        onChange={vi.fn()}
      />,
    );

    const first = screen.getByRole('radio', { name: 'A 선택' });
    const second = screen.getByRole('radio', { name: 'B 선택' });
    expect(first.id).not.toBe(second.id);
    expect(first.id).toContain('radio-a');
    expect(second.id).toContain('radio-b');
  });

  it('선택된 동적 행을 작성 순서에 맞춰 나열하고 항목 선택 UI를 유지한다', () => {
    render(
      <InteractiveTableResponse
        questionId="dynamic-table"
        columns={columns as never}
        rows={[
          rows[0],
          {
            id: 'dynamic-row',
            label: '동적 문항',
            dynamicGroupId: 'career',
            cells: [
              { id: 'dynamic-label', type: 'text', content: '동적 문항' },
              { id: 'dynamic-answer', type: 'input', content: '', placeholder: '동적 응답' },
            ],
          },
          rows[1],
        ] as never}
        dynamicRowConfigs={[
          { groupId: 'career', enabled: true, label: '진로 항목 선택' },
        ]}
        mobileTableDisplayMode="row-wise-original"
        mobileDrilldownOmitLeadingColumns={1}
        value={{ __selectedRowIds: ['dynamic-row'] }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /진로 항목 선택.*1개 선택/ })).toBeInTheDocument();
    const rowQuestions = document.querySelectorAll('[data-row-question-id]');
    expect([...rowQuestions].map((row) => row.getAttribute('data-row-question-id'))).toEqual([
      'row-1',
      'dynamic-row',
      'row-2',
    ]);

    fireEvent.click(screen.getByRole('button', { name: /진로 항목 선택.*1개 선택/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('ranking 셀의 실제 select에도 행 인스턴스 ID와 오류 설명을 연결한다', () => {
    render(
      <InteractiveTableResponse
        questionId="ranking-cell-table"
        columns={columns as never}
        rows={[
          {
            id: 'ranking-row',
            label: '순위 문항',
            cells: [
              { id: 'ranking-label', type: 'text', content: '순위 문항' },
              {
                id: 'ranking-answer',
                type: 'ranking',
                content: '',
                rankingConfig: { positions: 1 },
                rankingOptions: [
                  { id: 'option-a', label: 'A', value: 'a' },
                  { id: 'option-b', label: 'B', value: 'b' },
                ],
              },
            ],
          },
        ] as never}
        mobileTableDisplayMode="row-wise-original"
        mobileDrilldownOmitLeadingColumns={1}
        value={{}}
        onChange={vi.fn()}
        errorCellIds={new Set(['ranking-answer'])}
      />,
    );

    const select = screen.getByRole('combobox');
    expect(select).toHaveAttribute('id', 'ranking-row-ranking-answer-1');
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select.getAttribute('aria-describedby')).toBeTruthy();
  });
});
