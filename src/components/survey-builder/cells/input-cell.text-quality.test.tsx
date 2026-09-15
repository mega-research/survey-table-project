import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { TableCell } from '@/types/survey';

import { InputCell } from './input-cell';

function Harness({ cell }: { cell: TableCell }) {
  const [value, setValue] = useState<unknown>('');
  return (
    <InputCell
      cell={cell}
      cellResponse={value}
      onUpdateValue={setValue}
      questionId="q1"
      hintInFlow
    />
  );
}

function inputCell(overrides: Partial<TableCell> = {}): TableCell {
  return { id: 'c1', type: 'input', content: '', ...overrides } as TableCell;
}

describe('표 input 셀 응답 품질', () => {
  it('칸을 벗어나면 셀 아래에 최소 글자 수·의미 없는 입력 문구가 뜬다', async () => {
    const user = userEvent.setup();
    render(
      <Harness cell={inputCell({ textValidation: { minLength: 5, rejectMeaningless: true } })} />,
    );
    const input = screen.getByRole('textbox');

    await user.type(input, 'ㅋㅋ');
    // 치는 동안에는 숨긴다 — 한글 조합 중 첫 자모에 반응하지 않게
    expect(screen.queryByTestId('cell-text-quality-violation')).toBeNull();
    await user.tab();
    expect(screen.getByTestId('cell-text-quality-violation')).toHaveTextContent(
      '자음·모음이나 숫자만으로는 답할 수 없습니다.',
    );

    await user.clear(input);
    await user.type(input, '짧다');
    await user.tab();
    expect(screen.getByTestId('cell-text-quality-violation')).toHaveTextContent(
      '5자 이상 입력해 주세요. (현재 2자, 공백 제외)',
    );

    await user.clear(input);
    await user.type(input, '충분히 긴 답변');
    await user.tab();
    expect(screen.queryByTestId('cell-text-quality-violation')).toBeNull();
  });

  it('숫자 모드 셀은 검사하지 않는다', async () => {
    const user = userEvent.setup();
    render(<Harness cell={inputCell({ inputType: 'number', textValidation: { minLength: 5 } })} />);
    await user.type(screen.getByRole('textbox'), '12');
    expect(screen.queryByTestId('cell-text-quality-violation')).toBeNull();
  });
});
