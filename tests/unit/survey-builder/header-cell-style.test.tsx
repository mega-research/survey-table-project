import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { HeaderBulkStyleDialog } from '@/components/survey-builder/header-bulk-style-dialog';
import { HeaderGridEditor } from '@/components/survey-builder/header-grid-editor';
import { TableHeaderSection } from '@/components/survey-builder/table-header-section';
import type { HeaderCell, TableColumn } from '@/types/survey';

// 통 mock 은 import 체인이 늘면 깨지므로 importOriginal 을 spread 로 보강한다 (레포 관례)
vi.mock('@/stores/ui-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/stores/ui-store')>()),
  useSurveyUIStore: (selector: (s: unknown) => unknown) =>
    selector({ editingQuestionId: 'q1' }),
}));

vi.mock('@/stores/survey-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/stores/survey-store')>()),
  useSurveyBuilderStore: (selector: (s: unknown) => unknown) =>
    selector({ currentSurvey: { questions: [{ id: 'q1', hideColumnLabels: false }] } }),
}));

function grid(): HeaderCell[][] {
  return [
    [
      { id: 'h1', label: '상반기', colspan: 1, rowspan: 1 },
      { id: 'h2', label: '하반기', colspan: 1, rowspan: 1 },
    ],
  ];
}

describe('HeaderGridEditor 셀별 스타일', () => {
  it('셀마다 스타일 버튼이 하나씩 있다', () => {
    render(<HeaderGridEditor headerGrid={grid()} columnCount={2} onChange={vi.fn()} />);

    expect(screen.getAllByRole('button', { name: '헤더 셀 스타일' })).toHaveLength(2);
  });

  it('한 셀에 배경색을 지정하면 그 셀만 바뀌고 이웃 셀은 그대로다', async () => {
    const onChange = vi.fn();
    render(<HeaderGridEditor headerGrid={grid()} columnCount={2} onChange={onChange} />);

    const buttons = screen.getAllByRole('button', { name: '헤더 셀 스타일' });
    const first = buttons[0];
    expect(first).toBeDefined();
    await userEvent.click(first!);

    await userEvent.type(await screen.findByLabelText('HEX 색상'), 'abc');
    await userEvent.tab();

    expect(onChange).toHaveBeenCalledWith([
      [
        { id: 'h1', label: '상반기', colspan: 1, rowspan: 1, backgroundColor: '#AABBCC' },
        { id: 'h2', label: '하반기', colspan: 1, rowspan: 1 },
      ],
    ]);
  });

  it('배경색을 비우면 필드가 제거된다', async () => {
    const onChange = vi.fn();
    const styled: HeaderCell[][] = [
      [{ id: 'h1', label: '상반기', colspan: 1, rowspan: 1, backgroundColor: '#AABBCC' }],
    ];
    render(<HeaderGridEditor headerGrid={styled} columnCount={1} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: '헤더 셀 스타일' }));
    await userEvent.click(await screen.findByRole('button', { name: '배경색 없음' }));

    expect(onChange).toHaveBeenCalledWith([
      [{ id: 'h1', label: '상반기', colspan: 1, rowspan: 1 }],
    ]);
  });

  // 아래 두 테스트는 짝이다. 뒤쪽이 "셀을 누르면 선택된다"는 양성 대조군이라,
  // 앞쪽의 부정 단언이 stopPropagation 누락을 실제로 잡아낸다.
  it('스타일 버튼 클릭은 셀을 선택하지 않는다', async () => {
    const merged: HeaderCell[][] = [[{ id: 'h1', label: '상반기', colspan: 2, rowspan: 1 }]];
    render(<HeaderGridEditor headerGrid={merged} columnCount={2} onChange={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: '헤더 셀 스타일' }));

    // 병합 셀이 선택됐다면 "분할" 버튼이 나타난다
    expect(screen.queryByRole('button', { name: /분할/ })).not.toBeInTheDocument();
  });

  it('셀 본문을 mousedown 하면 선택되어 분할 버튼이 나타난다', () => {
    const merged: HeaderCell[][] = [[{ id: 'h1', label: '상반기', colspan: 2, rowspan: 1 }]];
    render(<HeaderGridEditor headerGrid={merged} columnCount={2} onChange={vi.fn()} />);

    fireEvent.mouseDown(screen.getByText('상반기'), { detail: 1 });

    expect(screen.getByRole('button', { name: /분할/ })).toBeInTheDocument();
  });
});

function noopColumnCallbacks() {
  return {
    onUpdateColumnLabel: vi.fn(),
    onUpdateColumnCode: vi.fn(),
    onMoveColumn: vi.fn(),
    onDeleteColumn: vi.fn(),
    onMergeColumnHeaders: vi.fn(),
    onUnmergeColumnHeader: vi.fn(),
    onSetEditingColumnWidth: vi.fn(),
    onColumnWidthChange: vi.fn(),
  };
}

describe('TableHeaderSection 열별 스타일', () => {
  it('열 설정 팝오버에서 배경색을 지정하면 해당 열 인덱스로 전달된다', async () => {
    const onUpdateColumnStyle = vi.fn();
    const columns: TableColumn[] = [
      { id: 'c1', label: '남성' },
      { id: 'c2', label: '여성' },
    ];
    render(
      <TableHeaderSection
        columns={columns}
        editingColumnWidth={null}
        {...noopColumnCallbacks()}
        onUpdateColumnStyle={onUpdateColumnStyle}
      />,
    );

    const settingsButtons = screen.getAllByRole('button', { name: '열 설정' });
    const second = settingsButtons[1];
    expect(second).toBeDefined();
    await userEvent.click(second!);

    await userEvent.type(await screen.findByLabelText('HEX 색상'), 'abc');
    await userEvent.tab();

    expect(onUpdateColumnStyle).toHaveBeenCalledWith(1, false, '#AABBCC');
  });

  it('이미 지정된 스타일이 팝오버 초기값으로 나타난다', async () => {
    render(
      <TableHeaderSection
        columns={[{ id: 'c1', label: '남성', backgroundColor: '#112233', textBold: true }]}
        editingColumnWidth={null}
        {...noopColumnCallbacks()}
        onUpdateColumnStyle={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '열 설정' }));

    expect(await screen.findByLabelText('HEX 색상')).toHaveValue('#112233');
    expect(screen.getByLabelText('텍스트 굵게')).toBeChecked();
  });
});

describe('HeaderBulkStyleDialog 확인 단계', () => {
  it('스타일이 균일하면 확인 없이 즉시 적용한다', async () => {
    const onApply = vi.fn();
    render(
      <HeaderBulkStyleDialog
        open
        onOpenChange={vi.fn()}
        initialStyle={{
          textBold: false,
          backgroundColor: '',
          isMixed: false,
          styledCount: 0,
        }}
        onApply={onApply}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '전체 헤더에 적용' }));

    expect(onApply).toHaveBeenCalledWith({ textBold: false, backgroundColor: '' });
  });

  it('스타일이 섞여 있으면 확인 문구를 먼저 띄우고 적용하지 않는다', async () => {
    const onApply = vi.fn();
    render(
      <HeaderBulkStyleDialog
        open
        onOpenChange={vi.fn()}
        initialStyle={{
          textBold: false,
          backgroundColor: '',
          isMixed: true,
          styledCount: 3,
        }}
        onApply={onApply}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '전체 헤더에 적용' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      '개별 지정된 헤더 스타일 3개가 초기화됩니다.',
    );
    expect(onApply).not.toHaveBeenCalled();
  });

  it('확인에서 계속을 누르면 적용한다', async () => {
    const onApply = vi.fn();
    render(
      <HeaderBulkStyleDialog
        open
        onOpenChange={vi.fn()}
        initialStyle={{
          textBold: true,
          backgroundColor: '#AABBCC',
          isMixed: true,
          styledCount: 3,
        }}
        onApply={onApply}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '전체 헤더에 적용' }));
    await userEvent.click(screen.getByRole('button', { name: '계속' }));

    expect(onApply).toHaveBeenCalledWith({ textBold: true, backgroundColor: '#AABBCC' });
  });

  it('확인에서 취소를 누르면 적용하지 않고 다시 적용 버튼으로 돌아간다', async () => {
    const onApply = vi.fn();
    render(
      <HeaderBulkStyleDialog
        open
        onOpenChange={vi.fn()}
        initialStyle={{
          textBold: false,
          backgroundColor: '',
          isMixed: true,
          styledCount: 2,
        }}
        onApply={onApply}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '전체 헤더에 적용' }));
    await userEvent.click(screen.getByRole('button', { name: '취소' }));

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '전체 헤더에 적용' })).toBeInTheDocument();
  });

  it('잘못된 HEX 는 확인 단계로 넘어가지 않는다', async () => {
    const onApply = vi.fn();
    render(
      <HeaderBulkStyleDialog
        open
        onOpenChange={vi.fn()}
        initialStyle={{
          textBold: false,
          backgroundColor: '',
          isMixed: true,
          styledCount: 2,
        }}
        onApply={onApply}
      />,
    );

    await userEvent.type(screen.getByLabelText('HEX 색상'), 'zz');
    await userEvent.click(screen.getByRole('button', { name: '전체 헤더에 적용' }));

    expect(screen.getByRole('alert')).toHaveTextContent('3자리 또는 6자리 HEX 색상을 입력하세요.');
    expect(onApply).not.toHaveBeenCalled();
  });
});
