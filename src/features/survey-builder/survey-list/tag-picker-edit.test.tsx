import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { MinePersonalTagsOutput, PersonalTagItem } from '@/shared/contracts/workspace-io';

import { personalTagKeys } from '../queries/use-personal-marks';
import { TagPickerPanel } from './tag-picker';

// 태그 창의 줄 「⋯」 → 옆 편집 패널 (설문 즐겨찾기·태그 티켓 08, 시안 F6 ③).

vi.mock('@/shared/lib/rpc', () => ({
  client: { workspace: { personalMarks: { updateTag: vi.fn(), deleteTag: vi.fn() } } },
  orpc: { workspace: { personalMarks: { mine: { call: vi.fn() } } } },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const A: PersonalTagItem = { id: 'a', name: 'A사', color: 'blue', linkCount: 1 };
const B: PersonalTagItem = { id: 'b', name: 'B기관', color: 'teal', linkCount: 2 };

function renderPicker() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData<MinePersonalTagsOutput>(personalTagKeys.mine(), { tags: [A, B] });
  const onToggle = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <TagPickerPanel
        attachedIds={['a']}
        tags={[A, B]}
        onToggle={onToggle}
        onCreate={vi.fn(async () => null)}
      />
    </QueryClientProvider>,
  );
  return { onToggle, user: userEvent.setup() };
}

describe('태그 창 — 줄의 「⋯」', () => {
  it('「⋯」를 누르면 그 태그의 편집 패널이 열린다 — 붙이기·떼기는 일어나지 않는다', async () => {
    const { user, onToggle } = renderPicker();
    await user.click(screen.getByRole('button', { name: 'B기관 편집' }));
    expect(await screen.findByRole('textbox', { name: '태그 이름' })).toHaveValue('B기관');
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('다른 줄의 「⋯」를 누르면 패널이 그 태그로 옮겨 간다 — 한 번에 한 태그만', async () => {
    const { user } = renderPicker();
    await user.click(screen.getByRole('button', { name: 'B기관 편집' }));
    await screen.findByRole('textbox', { name: '태그 이름' });

    await user.click(screen.getByRole('button', { name: 'A사 편집' }));
    await waitFor(() => {
      const fields = screen.getAllByRole('textbox', { name: '태그 이름' });
      expect(fields).toHaveLength(1);
      expect(fields[0]).toHaveValue('A사');
    });
  });

  it('이름 칸에서 Esc → 패널만 닫힌다', async () => {
    const { user } = renderPicker();
    await user.click(screen.getByRole('button', { name: 'B기관 편집' }));
    await screen.findByRole('textbox', { name: '태그 이름' });
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: '태그 이름' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('listbox', { name: '내 태그' })).toBeInTheDocument();
  });
});
