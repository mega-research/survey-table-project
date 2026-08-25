import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

describe('SelectContent', () => {
  it('열린 목록에 viewport 기반 최대 높이 제한을 건다', () => {
    render(
      <Select defaultOpen>
        <SelectTrigger>
          <SelectValue placeholder="문항 선택" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="q1">문항 1</SelectItem>
          <SelectItem value="q2">문항 2</SelectItem>
        </SelectContent>
      </Select>,
    );

    const listbox = screen.getByRole('listbox');

    expect(listbox).toHaveStyle({
      maxHeight: 'min(var(--radix-select-content-available-height, 24rem), 24rem)',
    });
  });
});
