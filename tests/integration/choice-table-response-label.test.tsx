/**
 * 보기 옵션(choice_opt) 셀의 라벨을 라디오/체크박스 옆에 렌더하는지 검증.
 * - 라벨(choiceLabel > content)이 있으면 컨트롤 옆에 텍스트로 표시
 * - 비어 있으면 컨트롤만 (라벨 다른 열에 있는 경우 대비)
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Question, TableCell, TableRow } from '@/types/survey';

// 데스크톱 강제
vi.mock('@/hooks/use-media-query', () => ({
  useMobileView: () => false,
  useMediaQuery: () => false,
}));
// 컨택 토큰 컨텍스트 (provider 없이)
vi.mock('@/lib/survey/contact-attrs-context', () => ({
  useContactAttrs: () => ({}),
}));
// TablePreview 더블: renderCell 을 각 셀에 호출해 결과만 렌더한다.
vi.mock('@/components/survey-builder/table-preview', () => ({
  TablePreview: ({
    rows,
    renderCell,
  }: {
    rows: TableRow[];
    renderCell: (cell: TableCell) => React.ReactNode;
  }) => (
    <div>
      {rows.flatMap((r) => r.cells).map((cell) => (
        <div key={cell.id} data-testid={`cell-${cell.id}`}>
          {renderCell(cell)}
        </div>
      ))}
    </div>
  ),
}));

import { ChoiceTableResponse } from '@/components/survey-response/choice-table-response';

function radioQuestion(): Question {
  return {
    id: 'q1',
    type: 'radio',
    title: 'Q',
    required: false,
    order: 0,
    tableColumns: [
      { id: 'c1', label: '①' },
      { id: 'c2', label: '②' },
    ],
    tableRowsData: [
      {
        id: 'r1',
        label: '',
        cells: [
          { id: 'cellA', type: 'choice_opt', content: '매우 나쁨' },
          { id: 'cellB', type: 'choice_opt', content: '' },
        ],
      },
    ],
  } as Question;
}

// 그룹 라디오: onChange 없이 onClick 으로만 토글한다. controlled checked 에 대해
// React 가 onChange/readOnly 를 요구하므로 readOnly 가 없으면 console.error 경고가 난다.
function groupedRadioQuestion(): Question {
  return {
    id: 'q1',
    type: 'radio',
    title: 'Q',
    required: false,
    order: 0,
    choiceGroups: [{ id: 'g-rad', groupKey: 'rad1', type: 'radio', label: '만족도' }],
    tableColumns: [{ id: 'c1', label: '①' }],
    tableRowsData: [
      {
        id: 'r1',
        label: '',
        cells: [
          {
            id: 'cellA',
            type: 'choice_opt',
            content: '매우 나쁨',
            choiceGroupId: 'g-rad',
          },
        ],
      },
    ],
  } as Question;
}

describe('ChoiceTableResponse 그룹 라디오 controlled 경고', () => {
  it('그룹 라디오 셀 렌더 시 onChange 없는 controlled 경고가 나지 않는다', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ChoiceTableResponse question={groupedRadioQuestion()} value={{}} onChange={vi.fn()} />,
    );
    const offending = errSpy.mock.calls.filter((args) =>
      String(args[0] ?? '').includes('onChange'),
    );
    errSpy.mockRestore();
    expect(offending).toEqual([]);
  });
});

describe('ChoiceTableResponse 라벨 렌더 (데스크톱)', () => {
  it('라벨이 있는 보기 옵션 셀은 컨트롤 옆에 텍스트를 표시한다', () => {
    render(<ChoiceTableResponse question={radioQuestion()} value={null} onChange={vi.fn()} />);
    const cellA = screen.getByTestId('cell-cellA');
    expect(within(cellA).getByText('매우 나쁨')).toBeTruthy();
    expect(within(cellA).getByRole('radio')).toBeTruthy();
  });

  it('내용이 비어 있는 셀은 라벨 없이 컨트롤만 표시한다', () => {
    render(<ChoiceTableResponse question={radioQuestion()} value={null} onChange={vi.fn()} />);
    const cellB = screen.getByTestId('cell-cellB');
    expect(within(cellB).getByRole('radio')).toBeTruthy();
    // 비어있으면 '(라벨 없음)' 등 텍스트가 노출되면 안 된다.
    expect(within(cellB).queryByText('(라벨 없음)')).toBeNull();
    expect(cellB.textContent?.trim()).toBe('');
  });
});
