import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { TableCell, TableRow } from '@/types/survey';

import { RowRepeatSettingsCard } from './row-repeat-settings-card';

function cell(id: string, type: TableCell['type'] = 'input'): TableCell {
  return { id, content: '', type };
}

const rows: TableRow[] = [
  { id: 'head', label: '머리', cells: [cell('h1', 'text')] },
  { id: 'a', label: '성과명', cells: [cell('a1')] },
  { id: 'b', label: '연도', cells: [cell('b1')] },
];

async function pickRange(user: ReturnType<typeof userEvent.setup>, start: string, end: string) {
  await user.selectOptions(screen.getByLabelText('시작 행'), start);
  await user.selectOptions(screen.getByLabelText('끝 행'), end);
}

describe('행 반복 설정 카드', () => {
  it('연속 범위를 고르고 켜면 템플릿 행과 상한을 올려 보낸다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RowRepeatSettingsCard rows={rows} onChange={onChange} />);

    await pickRange(user, 'a', 'b');
    await user.click(screen.getByRole('button', { name: '반복 켜기' }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, templateRowIds: ['a', 'b'], maxRepeats: 20 }),
    );
  });

  it('선택 셀이 든 행을 고르면 위반을 알리고 켜지 못하게 한다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const withRadio: TableRow[] = [
      rows[0]!,
      { id: 'a', label: '성과명', cells: [cell('a1', 'radio')] },
      rows[2]!,
    ];
    render(<RowRepeatSettingsCard rows={withRadio} onChange={onChange} />);

    await pickRange(user, 'a', 'a');

    expect(screen.getByText(/입력 셀과 표시용 텍스트 셀만/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '반복 켜기' })).toBeDisabled();
  });

  it('합계 제약이 참조하는 행은 지정을 막는다', async () => {
    const user = userEvent.setup();
    render(
      <RowRepeatSettingsCard
        rows={rows}
        sumConstraints={[{ id: 's1', cellIds: ['a1'], operator: 'eq', target: 100 }]}
        onChange={vi.fn()}
      />,
    );

    await pickRange(user, 'a', 'b');

    expect(screen.getByText(/합계 제약이 참조하는 행/)).toBeInTheDocument();
  });

  it('반복을 끌 때 확인을 받고 null 을 올려 보낸다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <RowRepeatSettingsCard
        rows={rows}
        config={{ enabled: true, templateRowIds: ['a'], maxRepeats: 20 }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: '반복 끄기' }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(null);
    confirmSpy.mockRestore();
  });

  it('확인을 거절하면 끄지 않는다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      <RowRepeatSettingsCard
        rows={rows}
        config={{ enabled: true, templateRowIds: ['a'], maxRepeats: 20 }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: '반복 끄기' }));

    expect(onChange).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('상한을 줄일 때도 확인을 받는다', () => {
    const onChange = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <RowRepeatSettingsCard
        rows={rows}
        config={{ enabled: true, templateRowIds: ['a'], maxRepeats: 20 }}
        onChange={onChange}
      />,
    );

    // 입력칸은 controlled 라 타이핑 시뮬레이션 대신 값 변경 이벤트를 직접 준다.
    fireEvent.change(screen.getByLabelText('최대 벌 수'), { target: { value: '5' } });

    expect(confirmSpy).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ maxRepeats: 5 }));
    confirmSpy.mockRestore();
  });

  it('이미 펼쳐진 2벌 이후 행은 지정 후보로 나오지 않는다', () => {
    const expanded: TableRow[] = [
      ...rows,
      { id: 'a2', label: '성과명 ②', repeatIndex: 2, repeatSourceRowId: 'a', cells: [cell('a1b')] },
    ];
    render(<RowRepeatSettingsCard rows={expanded} onChange={vi.fn()} />);
    expect(screen.queryByRole('option', { name: /성과명 ②/ })).toBeNull();
  });

  it('켠 뒤에도 범위를 바꿀 수 있다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RowRepeatSettingsCard
        rows={rows}
        config={{ enabled: true, templateRowIds: ['a'], maxRepeats: 20 }}
        onChange={onChange}
      />,
    );

    // 끝 행을 b 로 넓히면 선택이 유지되고 적용 버튼이 나온다
    await user.selectOptions(screen.getByLabelText('끝 행'), 'b');
    expect(screen.getByLabelText('끝 행')).toHaveValue('b');

    await user.click(screen.getByRole('button', { name: '범위 적용' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ templateRowIds: ['a', 'b'] }),
    );
  });

  it('활성 설정이 바뀌면 초안도 그 값으로 따라간다', () => {
    const { rerender } = render(
      <RowRepeatSettingsCard
        rows={rows}
        config={{ enabled: true, templateRowIds: ['a'], maxRepeats: 20 }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('끝 행')).toHaveValue('a');

    rerender(
      <RowRepeatSettingsCard
        rows={rows}
        config={{ enabled: true, templateRowIds: ['a', 'b'], maxRepeats: 20 }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('끝 행')).toHaveValue('b');
  });
});
