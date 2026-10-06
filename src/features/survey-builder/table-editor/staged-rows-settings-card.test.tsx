import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { StagedRowsConfig, TableCell, TableRow } from '@/types/survey';

import { StagedRowsSettingsCard } from './staged-rows-settings-card';

function cell(id: string, type: TableCell['type'] = 'input'): TableCell {
  return { id, content: '', type };
}

/** 머리 행 + 국가 4행(선택 칸 + 입력 칸) + 합계 행 */
const rows: TableRow[] = [
  { id: 'head', label: '수출액', cells: [cell('h1'), cell('h2')] },
  { id: 's1', label: '국가 1', cells: [cell('s1a', 'select'), cell('s1b')] },
  { id: 's2', label: '국가 2', cells: [cell('s2a', 'select'), cell('s2b')] },
  { id: 's3', label: '국가 3', cells: [cell('s3a', 'select'), cell('s3b')] },
  { id: 's4', label: '국가 4', cells: [cell('s4a', 'select'), cell('s4b')] },
  { id: 'tail', label: '합계', cells: [cell('t1', 'text'), cell('t2', 'text')] },
];

const active: StagedRowsConfig = {
  enabled: true,
  rowIds: ['s1', 's2', 's3', 's4'],
  initialVisibleCount: 2,
  addLabel: '국가 추가',
};

async function pickRange(user: ReturnType<typeof userEvent.setup>, start: string, end: string) {
  await user.selectOptions(screen.getByLabelText('묶음 시작 행'), start);
  await user.selectOptions(screen.getByLabelText('묶음 끝 행'), end);
}

describe('행 차례로 열기 설정 카드', () => {
  it('범위와 처음 보이는 행 수를 정하고 켜면 설정을 올려 보낸다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StagedRowsSettingsCard rows={rows} onChange={onChange} />);

    await pickRange(user, 's1', 's4');
    fireEvent.change(screen.getByLabelText('처음 보이는 행 수'), { target: { value: '2' } });
    await user.click(screen.getByRole('button', { name: '차례로 열기 켜기' }));

    expect(onChange).toHaveBeenCalledWith({
      enabled: true,
      rowIds: ['s1', 's2', 's3', 's4'],
      initialVisibleCount: 2,
    });
  });

  it('선택 칸이 든 행도 묶을 수 있다 — 행 반복과 다르다', async () => {
    const user = userEvent.setup();
    render(<StagedRowsSettingsCard rows={rows} onChange={vi.fn()} />);

    await pickRange(user, 's1', 's4');

    expect(screen.getByRole('button', { name: '차례로 열기 켜기' })).toBeEnabled();
  });

  it('처음 보이는 행 수가 묶음 행 수 이상이면 위반을 알리고 켜지 못하게 한다', async () => {
    const user = userEvent.setup();
    render(<StagedRowsSettingsCard rows={rows} onChange={vi.fn()} />);

    await pickRange(user, 's1', 's2');
    fireEvent.change(screen.getByLabelText('처음 보이는 행 수'), { target: { value: '2' } });

    expect(screen.getByText(/처음 보이는 행 수는 1 이상 1 이하/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '차례로 열기 켜기' })).toBeDisabled();
  });

  it('표시 조건이 걸린 행은 지정을 막는다', async () => {
    const user = userEvent.setup();
    const withCondition = rows.map((row) =>
      row.id === 's2' ? { ...row, displayCondition: { logicType: 'AND', conditions: [] } } : row,
    ) as TableRow[];
    render(<StagedRowsSettingsCard rows={withCondition} onChange={vi.fn()} />);

    await pickRange(user, 's1', 's4');

    expect(screen.getByText(/표시 조건이 걸린 행/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '차례로 열기 켜기' })).toBeDisabled();
  });

  it('보기 옵션 셀이 든 행은 지정을 막는다 — 그 선택은 행의 칸 값이 아닌 곳에 저장된다', async () => {
    const user = userEvent.setup();
    const withChoice = rows.map((row) =>
      row.id === 's3' ? { ...row, cells: [cell('opt', 'choice_opt'), cell('s3b')] } : row,
    );
    render(<StagedRowsSettingsCard rows={withChoice} onChange={vi.fn()} />);

    await pickRange(user, 's1', 's4');

    expect(screen.getByText(/보기 옵션·순위 옵션 셀이 든 행/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '차례로 열기 켜기' })).toBeDisabled();
  });

  it('행 반복으로 펼쳐진 2벌 이후 행은 후보에 나오지 않는다', () => {
    const withRepeat: TableRow[] = [
      ...rows,
      { id: 'rp1', label: '성과', repeatIndex: 1, cells: [cell('p1'), cell('p2')] },
      { id: 'rp2', label: '성과', repeatIndex: 2, cells: [cell('p3'), cell('p4')] },
    ];
    render(<StagedRowsSettingsCard rows={withRepeat} onChange={vi.fn()} />);

    const options = [...screen.getByLabelText('묶음 시작 행').querySelectorAll('option')].map(
      (option) => option.value,
    );
    expect(options).toContain('rp1');
    expect(options).not.toContain('rp2');
  });

  it('켜진 설정은 범위·행 수·문구를 보이고, 문구를 고치면 바로 올려 보낸다', () => {
    const onChange = vi.fn();
    render(<StagedRowsSettingsCard rows={rows} config={active} onChange={onChange} />);

    expect(screen.getByLabelText('묶음 시작 행')).toHaveValue('s1');
    expect(screen.getByLabelText('묶음 끝 행')).toHaveValue('s4');
    expect(screen.getByLabelText('처음 보이는 행 수')).toHaveValue(2);
    expect(screen.getByText('처음 2행 · 최대 4행')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('열기 버튼 문구'), { target: { value: '행 더하기' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...active, addLabel: '행 더하기' });
  });

  it('켜진 상태에서 처음 보이는 행 수를 고치면 올려 보내고, 범위를 벗어난 값은 보내지 않는다', () => {
    const onChange = vi.fn();
    render(<StagedRowsSettingsCard rows={rows} config={active} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('처음 보이는 행 수'), { target: { value: '3' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...active, initialVisibleCount: 3 });

    onChange.mockClear();
    fireEvent.change(screen.getByLabelText('처음 보이는 행 수'), { target: { value: '4' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/처음 보이는 행 수는 1 이상 3 이하/)).toBeInTheDocument();
  });

  it('끄면 null 을 올려 보낸다 — 행은 그대로라 확인을 받지 않는다', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StagedRowsSettingsCard rows={rows} config={active} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: '차례로 열기 끄기' }));

    expect(onChange).toHaveBeenCalledWith(null);
  });
});
