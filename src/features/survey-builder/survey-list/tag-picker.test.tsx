import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { PersonalTagItem } from '@/shared/contracts/workspace-io';

import { TagPickerPanel } from './tag-picker';

// 태그 창 (설문 즐겨찾기·태그 티켓 07, 시안 F6 ①②).

function tag(id: string, name: string): PersonalTagItem {
  return { id, name, color: 'blue', linkCount: 0 };
}

const A = tag('a', 'A사');
const B = tag('b', '이번주 마감');
const C = tag('c', '정기조사');

function renderPanel(
  over: Partial<{
    attachedIds: string[];
    tags: PersonalTagItem[];
    onToggle: (tagId: string, on: boolean) => void;
    onCreate: (name: string) => Promise<PersonalTagItem | null>;
  }> = {},
) {
  const props = {
    attachedIds: ['a'],
    tags: [A, B, C],
    onToggle: vi.fn(),
    onCreate: vi.fn(async (name: string) => tag('new', name)),
    ...over,
  };
  render(<TagPickerPanel {...props} />);
  return { ...props, user: userEvent.setup() };
}

describe('태그 창', () => {
  it('붙은 태그는 위에 칩으로, 내 태그 목록은 아래에 — 붙은 줄은 선택됨으로 보인다', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: 'A사 태그 떼기' })).toBeInTheDocument();
    const list = screen.getByRole('listbox', { name: '내 태그' });
    const options = within(list).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['A사', '이번주 마감', '정기조사']);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('내 태그 · 나에게만 보입니다')).toBeInTheDocument();
  });

  it('목록의 태그를 누르면 붙이고, 붙은 태그를 누르면 뗀다 — 칩의 × 로도 뗀다', async () => {
    const { user, onToggle } = renderPanel();
    await user.click(screen.getByRole('option', { name: '이번주 마감' }));
    expect(onToggle).toHaveBeenLastCalledWith('b', true);
    await user.click(screen.getByRole('option', { name: 'A사' }));
    expect(onToggle).toHaveBeenLastCalledWith('a', false);
    await user.click(screen.getByRole('button', { name: 'A사 태그 떼기' }));
    expect(onToggle).toHaveBeenLastCalledWith('a', false);
  });

  it('글자를 치면 목록이 좁혀지고, 없는 이름이면 만들기가 맨 아래에 뜬다 — Enter 로 만들고 칸을 비운다', async () => {
    const { user, onCreate } = renderPanel();
    const input = screen.getByRole('combobox', { name: '검색하거나 새 태그 이름 입력' });

    await user.type(input, '정기');
    // 일부만 맞는 태그는 위에, 「정기」라는 이름은 없으니 만들기가 맨 아래에.
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '정기조사',
      '만들기정기Enter',
    ]);

    await user.clear(input);
    await user.type(input, 'C사');
    expect(screen.getByText('「C사」와 같은 태그가 없습니다')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /만들기 C사/ })).toBeInTheDocument();

    await user.keyboard('{Enter}');
    expect(onCreate).toHaveBeenCalledWith('C사');
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('공백·대소문자만 다른 이름은 만들기를 내지 않는다', async () => {
    const { user } = renderPanel();
    await user.type(screen.getByRole('combobox'), ' a사');
    expect(screen.queryByRole('option', { name: /만들기/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['A사']);
  });

  it('↓ 로 고르고 Enter 로 붙인다', async () => {
    const { user, onToggle } = renderPanel();
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onToggle).toHaveBeenLastCalledWith('b', true);
  });

  it('20자를 넘는 입력은 받지 않고 이유를 알린다', async () => {
    const { user } = renderPanel();
    const input = screen.getByRole('combobox');
    await user.type(input, '가'.repeat(20));
    await user.type(input, '나');
    expect(input).toHaveValue('가'.repeat(20));
    expect(screen.getByRole('status')).toHaveTextContent('태그 이름은 20자까지입니다');
  });

  it('300개면 만들기 대신 한도 안내가 보인다', async () => {
    const many = Array.from({ length: 300 }, (_, i) => tag(`t${i}`, `키워드${i}`));
    const { user, onCreate } = renderPanel({ tags: many, attachedIds: [] });
    await user.type(screen.getByRole('combobox'), '새이름');
    expect(screen.queryByRole('option', { name: /만들기/ })).not.toBeInTheDocument();
    expect(screen.getByText('태그는 300개까지 만들 수 있습니다')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('「만들기」 미리보기 점은 서버가 배정할 색이다 — 내 태그에서 가장 덜 쓴 색, 같으면 어휘 순서', async () => {
    // 파랑 둘·빨강 하나 → 아직 안 쓴 초록이 어휘 순서로 앞선다.
    const { user } = renderPanel({
      tags: [A, B, { ...C, color: 'red' }],
    });
    await user.type(screen.getByRole('combobox', { name: '검색하거나 새 태그 이름 입력' }), 'C사');
    const create = screen.getByRole('option', { name: /만들기 C사/ });
    const dot = create.querySelector('[aria-hidden].rounded-full');
    expect(dot).toHaveClass('bg-[#22C55E]');
  });

  it('붙은 태그가 위에 모인다 — 창이 열려 있는 동안 붙이고 떼도 줄 순서는 그대로다', async () => {
    const props = {
      attachedIds: ['c'],
      tags: [A, B, C],
      onToggle: vi.fn(),
      onCreate: vi.fn(async () => null),
    };
    const { rerender } = render(<TagPickerPanel {...props} />);
    const names = () => screen.getAllByRole('option').map((o) => o.textContent);
    expect(names()).toEqual(['정기조사', 'A사', '이번주 마감']);

    // 열린 창에서 A사를 붙이고 정기조사를 뗐다 — 줄이 튀지 않는다.
    rerender(<TagPickerPanel {...props} attachedIds={['a']} />);
    expect(names()).toEqual(['정기조사', 'A사', '이번주 마감']);
    expect(screen.getByRole('option', { name: '정기조사' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('option', { name: 'A사' })).toHaveAttribute('aria-selected', 'true');
  });

  it('이름 칸의 포커스 링이 글자에 붙지 않는다 — 칸에 안쪽 여백이 있고 글자 줄은 칩과 맞춘다', () => {
    renderPanel();
    const input = screen.getByRole('combobox', { name: '검색하거나 새 태그 이름 입력' });
    expect(input).toHaveClass('px-2', '-mx-2', 'rounded-md');
  });
});
