import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function renderSelect(props: {
  value?: string;
  onValueChange?: (v: string) => void;
  defaultOpen?: boolean;
}) {
  return render(
    <Select {...props}>
      <SelectTrigger aria-label="문항">
        <SelectValue placeholder="문항 선택" />
      </SelectTrigger>
      <SelectContent>
        <div>
          <SelectGroup>
            <SelectLabel>기본</SelectLabel>
            <SelectItem value="q1">문항 1</SelectItem>
          </SelectGroup>
        </div>
        <SelectItem value="q2">문항 2</SelectItem>
      </SelectContent>
    </Select>,
  );
}

describe('SelectContent', () => {
  it('열린 목록에 viewport 기반 최대 높이 제한을 건다 — 상한은 Popup, 스크롤은 목록', async () => {
    renderSelect({ defaultOpen: true });

    const listbox = await screen.findByRole('listbox');
    const popup = listbox.closest('[data-side]') ?? listbox;
    expect(
      [popup, listbox].some((el) =>
        el.className.includes('max-h-[min(var(--available-height,24rem),24rem)]'),
      ),
    ).toBe(true);
  });
});

describe('Select — Radix 에서 넘어온 계약', () => {
  it('고른 값의 라벨을 트리거에 그린다 — 원시 value 가 아니다(항목이 div·그룹 안에 있어도)', () => {
    const { unmount } = renderSelect({ value: 'q1' });
    expect(screen.getByRole('combobox', { name: '문항' })).toHaveTextContent('문항 1');
    expect(screen.getByRole('combobox', { name: '문항' })).not.toHaveTextContent('q1');
    unmount();
    renderSelect({ value: 'q2' });
    expect(screen.getByRole('combobox', { name: '문항' })).toHaveTextContent('문항 2');
  });

  it('빈 문자열 value 는 고르지 않은 것이다 — placeholder 를 그린다', () => {
    renderSelect({ value: '' });
    expect(screen.getByRole('combobox', { name: '문항' })).toHaveTextContent('문항 선택');
  });

  it('onValueChange 는 고른 value 문자열 하나만 받는다', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderSelect({ value: 'q1', onValueChange });
    await user.click(screen.getByRole('combobox', { name: '문항' }));
    await user.click(await screen.findByRole('option', { name: '문항 2' }));
    expect(onValueChange).toHaveBeenCalledWith('q2');
    expect(onValueChange.mock.calls[0]).toHaveLength(1);
  });
});
