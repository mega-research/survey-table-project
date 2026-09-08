import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { TableCell } from '@/types/survey';

import { InputCell } from './input-cell';

function Harness({ cell }: { cell: TableCell }) {
  const [value, setValue] = useState<unknown>('');
  return <InputCell cell={cell} cellResponse={value} onUpdateValue={setValue} questionId="q1" />;
}

function inputCell(overrides: Partial<TableCell> = {}): TableCell {
  return { id: 'c1', type: 'input', content: '', ...overrides } as TableCell;
}

describe('표 input 셀 입력 형식', () => {
  it('타이핑 중에는 건드리지 않고 blur 시 정돈한다', async () => {
    const user = userEvent.setup();
    render(<Harness cell={inputCell({ inputType: 'phone' })} />);
    const input = screen.getByRole('textbox');

    await user.type(input, '021234567');
    expect(input).toHaveValue('021234567');

    await user.tab();
    expect(input).toHaveValue('02-123-4567');
  });

  it('형식이 틀리면 blur 후 셀 아래에 사유 문구가 뜬다', async () => {
    const user = userEvent.setup();
    render(<Harness cell={inputCell({ inputType: 'biz_number' })} />);
    const input = screen.getByRole('textbox');

    await user.type(input, '111-11-11111');
    expect(screen.queryByText(/확인번호가 맞지 않습니다/)).not.toBeInTheDocument();

    await user.tab();
    expect(screen.getByText(/사업자번호 확인번호가 맞지 않습니다/)).toBeInTheDocument();
    expect(input).toHaveValue('111-11-11111');
  });

  it('형식 미지정 셀은 blur 해도 값이 그대로다', async () => {
    const user = userEvent.setup();
    render(<Harness cell={inputCell()} />);
    const input = screen.getByRole('textbox');
    await user.type(input, '021234567');
    await user.tab();
    expect(input).toHaveValue('021234567');
  });
});
