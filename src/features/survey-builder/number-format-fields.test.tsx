import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NumberFormatFields } from '@/features/survey-builder/number-format-fields';
import type { NumberFormat } from '@/types/survey';

describe('NumberFormatFields 허용값 설정', () => {
  it('쉼표로 여러 허용값을 입력해 저장하고 오류 메시지 설정은 표시하지 않는다', async () => {
    const onChange = vi.fn<(next: NumberFormat | undefined) => void>();
    const user = userEvent.setup();

    function Harness() {
      const [value, setValue] = useState<NumberFormat>();
      return (
        <NumberFormatFields
          value={value}
          onChange={(next) => {
            setValue(next);
            onChange(next);
          }}
          idPrefix="test"
        />
      );
    }

    render(<Harness />);

    const allowedValues = screen.getByLabelText('허용값');
    await user.type(allowedValues, '2, 8');
    expect(allowedValues).toHaveValue('2, 8');

    const latest = onChange.mock.calls.at(-1)?.[0];
    expect(latest).toMatchObject({ allowedValues: [2, 8] });
    expect(screen.queryByLabelText('허용값 오류 메시지')).not.toBeInTheDocument();
  });

  it('「시작-끝」 범위를 펼쳐 저장하고, 칸을 떠나면 범위로 묶어 보인다', async () => {
    const onChange = vi.fn<(next: NumberFormat | undefined) => void>();
    const user = userEvent.setup();

    function Harness() {
      const [value, setValue] = useState<NumberFormat | undefined>({ min: 1900, max: 9999 });
      return (
        <NumberFormatFields
          value={value}
          onChange={(next) => {
            setValue(next);
            onChange(next);
          }}
          idPrefix="test"
        />
      );
    }

    render(<Harness />);

    const allowedValues = screen.getByLabelText('허용값');
    await user.type(allowedValues, '9999, 1900-2026');
    const latest = onChange.mock.calls.at(-1)?.[0];
    expect(latest?.allowedValues).toHaveLength(128);
    expect(latest?.allowedValues).toContain(9999);
    expect(latest?.allowedValues).toContain(1950);
    expect(latest?.allowedValues).not.toContain(2027);

    await user.tab();
    expect(allowedValues).toHaveValue('1900-2026, 9999');
  });

  it('저장된 긴 목록은 범위로 묶어 보인다', () => {
    const values = [...Array.from({ length: 12 }, (_, i) => i + 1), 99];
    render(
      <NumberFormatFields value={{ allowedValues: values }} onChange={() => {}} idPrefix="test" />,
    );
    expect(screen.getByLabelText('허용값')).toHaveValue('1-12, 99');
  });
});
