import { StrictMode, useRef, useState } from 'react';

import { ORPCError } from '@orpc/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MinePersonalTagsOutput, PersonalTagItem } from '@/shared/contracts/workspace-io';

import { personalTagKeys } from '../queries/use-personal-marks';
import { TagEditMenu, TagEditPanel } from './tag-edit-panel';

// 태그 편집 패널 (설문 즐겨찾기·태그 티켓 08, 시안 F6 ③④) — 태그 창과 「# 태그」 목록이 함께 쓴다.

const rpc = vi.hoisted(() => ({ updateTag: vi.fn(), deleteTag: vi.fn() }));
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    workspace: { personalMarks: { updateTag: rpc.updateTag, deleteTag: rpc.deleteTag } },
  },
  orpc: { workspace: { personalMarks: { mine: { call: vi.fn() } } } },
}));

const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const A: PersonalTagItem = { id: 'a', name: 'A사', color: 'blue', linkCount: 1 };
const B: PersonalTagItem = { id: 'b', name: 'B기관', color: 'teal', linkCount: 2 };

function renderPanel(tag: PersonalTagItem = B) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData<MinePersonalTagsOutput>(personalTagKeys.mine(), { tags: [A, B] });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <div>
        <button type="button">바깥</button>
        <TagEditPanel tag={tag} onClose={onClose} />
      </div>
    </QueryClientProvider>,
  );
  const mine = () => queryClient.getQueryData<MinePersonalTagsOutput>(personalTagKeys.mine())!.tags;
  return { onClose, mine, user: userEvent.setup() };
}

beforeEach(() => {
  rpc.updateTag.mockReset().mockImplementation(async (input: { tagId: string }) => ({
    ...B,
    ...input,
    id: input.tagId,
  }));
  rpc.deleteTag.mockReset().mockImplementation(async (input: { tagId: string }) => input);
  toast.error.mockReset();
});

describe('태그 편집 패널', () => {
  it('이름 칸에 라벨이 있고 지금 이름이 들어 있다 — 색 견본은 지금 색만 눌린 단추다', () => {
    renderPanel();
    expect(screen.getByRole('textbox', { name: '태그 이름' })).toHaveValue('B기관');
    const colors = within(screen.getByRole('group', { name: '색' })).getAllByRole('button');
    expect(colors.map((c) => c.textContent)).toEqual([
      '파랑',
      '빨강',
      '초록',
      '보라',
      '노랑',
      '청록',
      '분홍',
      '회색',
    ]);
    expect(screen.getByRole('button', { name: '청록' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '파랑' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('색을 누르면 바로 저장되고 패널은 열린 채다', async () => {
    const { user, onClose, mine } = renderPanel();
    await user.click(screen.getByRole('button', { name: '보라' }));
    expect(rpc.updateTag).toHaveBeenCalledWith({ tagId: 'b', color: 'purple' });
    expect(mine()[1]!.color).toBe('purple');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('이름을 고치고 Enter → 저장하고 닫는다(앞뒤 공백은 걷는다)', async () => {
    const { user, onClose } = renderPanel();
    const input = screen.getByRole('textbox', { name: '태그 이름' });
    await user.clear(input);
    await user.type(input, ' C기관 {Enter}');
    expect(rpc.updateTag).toHaveBeenCalledWith({ tagId: 'b', name: 'C기관' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('이름을 고치고 바깥을 누르면 저장한다', async () => {
    const { user } = renderPanel();
    const input = screen.getByRole('textbox', { name: '태그 이름' });
    await user.clear(input);
    await user.type(input, 'D기관');
    await user.click(screen.getByRole('button', { name: '바깥' }));
    expect(rpc.updateTag).toHaveBeenCalledTimes(1);
    expect(rpc.updateTag).toHaveBeenCalledWith({ tagId: 'b', name: 'D기관' });
  });

  it('Esc 는 고친 이름을 버리고 닫는다 — 저장하지 않는다', async () => {
    const { user, onClose } = renderPanel();
    const input = screen.getByRole('textbox', { name: '태그 이름' });
    await user.clear(input);
    await user.type(input, '버릴 이름{Escape}');
    expect(onClose).toHaveBeenCalled();
    expect(input).toHaveValue('B기관');
    await user.click(screen.getByRole('button', { name: '바깥' }));
    expect(rpc.updateTag).not.toHaveBeenCalled();
  });

  it('다른 내 태그와 같은 이름(대소문자·공백 무시)이면 칸 아래에 문구, Enter 해도 보내지 않는다', async () => {
    const { user, onClose } = renderPanel();
    const input = screen.getByRole('textbox', { name: '태그 이름' });
    await user.clear(input);
    await user.type(input, ' a사{Enter}');
    expect(screen.getByText('이미 같은 이름의 태그가 있습니다')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(rpc.updateTag).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('20자를 넘는 입력은 받지 않고 칸 아래에 이유를 보인다', async () => {
    const { user } = renderPanel();
    const input = screen.getByRole('textbox', { name: '태그 이름' });
    await user.clear(input);
    await user.type(input, '가'.repeat(21));
    expect(input).toHaveValue('가'.repeat(20));
    expect(screen.getByText('태그 이름은 20자까지입니다')).toBeInTheDocument();
  });

  it('비운 채 Enter 는 보내지 않고 문구를 보인다', async () => {
    const { user } = renderPanel();
    const input = screen.getByRole('textbox', { name: '태그 이름' });
    await user.clear(input);
    await user.keyboard('{Enter}');
    expect(screen.getByText('태그 이름을 입력하세요')).toBeInTheDocument();
    expect(rpc.updateTag).not.toHaveBeenCalled();
  });

  it('서버가 이름 충돌로 거부하면(다른 탭에서 만든 이름) 칸 아래에 그 문구, 패널은 열린 채다', async () => {
    rpc.updateTag.mockRejectedValue(
      new ORPCError('CONFLICT', { message: '이미 같은 이름의 태그가 있습니다' }),
    );
    const { user, onClose } = renderPanel();
    const input = screen.getByRole('textbox', { name: '태그 이름' });
    await user.clear(input);
    await user.type(input, '새 이름{Enter}');
    expect(await screen.findByText('이미 같은 이름의 태그가 있습니다')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('삭제는 한 번 묻는다 — 붙은 설문 수와 함께, 취소하면 그대로', async () => {
    const { user } = renderPanel();
    await user.click(screen.getByRole('button', { name: '삭제' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('「B기관」 태그를 지울까요?')).toBeInTheDocument();
    expect(
      within(dialog).getByText('붙어 있던 설문 2건에서 떨어지고, 되돌릴 수 없습니다.'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '취소' }));
    expect(rpc.deleteTag).not.toHaveBeenCalled();
  });

  it('삭제 확인 → 지우고 닫는다, 내 태그에서 빠진다', async () => {
    const { user, onClose, mine } = renderPanel();
    await user.click(screen.getByRole('button', { name: '삭제' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '삭제' }));
    expect(rpc.deleteTag).toHaveBeenCalledWith({ tagId: 'b' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mine().map((t) => t.id)).toEqual(['a']);
  });
});

describe('「⋯」 편집 메뉴', () => {
  /** 목록 상자 + 「⋯」 하나 — 상자의 사각형을 잴 때마다 센다. */
  function MenuHarness({ onMeasureBox }: { onMeasureBox: () => void }) {
    const [open, setOpen] = useState(false);
    const boxRef = useRef<HTMLDivElement>(null);
    return (
      <div
        ref={(node) => {
          boxRef.current = node;
          if (node) {
            node.getBoundingClientRect = () => {
              onMeasureBox();
              return new DOMRect(600, 100, 340, 400);
            };
          }
        }}
      >
        <button type="button">바깥</button>
        <TagEditMenu tag={B} open={open} onOpenChange={setOpen} besideRef={boxRef} />
      </div>
    );
  }

  function renderMenu() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData<MinePersonalTagsOutput>(personalTagKeys.mine(), { tags: [A, B] });
    const onMeasureBox = vi.fn();
    render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <MenuHarness onMeasureBox={onMeasureBox} />
        </QueryClientProvider>
      </StrictMode>,
    );
    return { onMeasureBox, user: userEvent.setup() };
  }

  it('개발 모드(StrictMode)에서도 패널은 목록 상자를 기준으로 선다 — 떨어져 나간 단추를 잡지 않는다', async () => {
    const { user, onMeasureBox } = renderMenu();
    await user.click(screen.getByRole('button', { name: 'B기관 편집' }));
    expect(await screen.findByRole('textbox', { name: '태그 이름' })).toBeInTheDocument();
    await waitFor(() => expect(onMeasureBox).toHaveBeenCalled());
  });

  it('「⋯」를 다시 누르면 닫히고 포커스는 「⋯」로 돌아온다', async () => {
    const { user } = renderMenu();
    const trigger = screen.getByRole('button', { name: 'B기관 편집' });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.click(trigger);
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '태그 이름' })).toBeNull());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('바깥을 누르면 닫히고 포커스는 누른 곳에 남는다', async () => {
    const { user } = renderMenu();
    await user.click(screen.getByRole('button', { name: 'B기관 편집' }));
    await screen.findByRole('textbox', { name: '태그 이름' });
    await user.click(screen.getByRole('button', { name: '바깥' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '태그 이름' })).toBeNull());
    expect(screen.getByRole('button', { name: '바깥' })).toHaveFocus();
  });
});
