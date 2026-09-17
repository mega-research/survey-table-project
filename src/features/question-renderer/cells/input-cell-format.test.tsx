import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { TableCell } from '@/types/survey';

import { InputCell } from './input-cell';

function Harness({ cell, hintInFlow }: { cell: TableCell; hintInFlow?: boolean }) {
  const [value, setValue] = useState<unknown>('');
  return (
    <InputCell
      cell={cell}
      cellResponse={value}
      onUpdateValue={setValue}
      questionId="q1"
      hintInFlow={hintInFlow}
    />
  );
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

    // 체크섬은 꺼져 있다(ENFORCE_CHECKSUM=false) — 자릿수 위반으로 사유를 확인한다.
    await user.type(input, '111-11-1111');
    expect(screen.queryByText(/10자리입니다/)).not.toBeInTheDocument();

    await user.tab();
    expect(screen.getByText(/사업자번호는 10자리입니다/)).toBeInTheDocument();
    expect(input).toHaveValue('111-11-1111');
  });

  it('기본은 사유 문구를 셀 밖에 띄우고, hintInFlow 면 흐름 안(입력칸 아래)에 둔다', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness cell={inputCell({ inputType: 'biz_number' })} />);
    await user.type(screen.getByRole('textbox'), '111-11-1111');
    await user.tab();
    // body 로 포털돼 셀 컨테이너 밖(fixed)에 뜬다 — 표 스크롤 컨테이너가 잘라내지 못한다
    const floated = screen.getByText(/사업자번호는 10자리입니다/);
    const shell = floated.closest('[data-floating-hint]') as HTMLElement;
    expect(shell.className).toContain('fixed');
    expect(shell.parentElement).toBe(document.body);
    unmount();

    render(<Harness cell={inputCell({ inputType: 'biz_number' })} hintInFlow />);
    await user.type(screen.getByRole('textbox'), '111-11-1111');
    await user.tab();
    const inFlow = screen.getByText(/사업자번호는 10자리입니다/);
    expect(inFlow.closest('.absolute')).toBeNull();
    // 카드 안에서 잘리지 않도록 입력칸과 같은 흐름 컨테이너에 들어 있다
    expect(inFlow.closest('.flex-col')).toContainElement(screen.getByRole('textbox'));
  });

  it('번호 형식 칸은 글자가 쳐지지 않고 숫자와 하이픈만 들어간다', async () => {
    const user = userEvent.setup();
    render(<Harness cell={inputCell({ inputType: 'mobile' })} />);
    const input = screen.getByRole('textbox');
    await user.type(input, '010ab-1234 5678');
    expect(input).toHaveValue('010-12345678');
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
