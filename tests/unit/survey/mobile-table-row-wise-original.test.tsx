import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { InteractiveTableResponse } from '@/components/survey-builder/interactive-table-response';
import { useTestResponseStore } from '@/stores/test-response-store';

vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => true,
  useMediaQuery: () => true,
}));
vi.mock('@/lib/survey/contact-attrs-context', () => ({
  useContactAttrs: () => ({}),
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
    expect(screen.getByPlaceholderText('둘째 응답')).toHaveAttribute('aria-invalid', 'true');
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
});
