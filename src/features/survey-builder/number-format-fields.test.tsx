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
});
