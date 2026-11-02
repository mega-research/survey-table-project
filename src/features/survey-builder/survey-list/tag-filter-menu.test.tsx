import { useState } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { MinePersonalTagsOutput, PersonalTagItem } from '@/shared/contracts/workspace-io';

import { personalTagKeys } from '../queries/use-personal-marks';
import { TagFilterMenu } from './tag-filter-menu';

// 「⋯」 편집 패널(티켓 08)은 내 태그 캐시를 읽는다 — 조회·쓰기는 일어나지 않게 막아 둔다.
vi.mock('@/shared/lib/rpc', () => ({
  client: { workspace: { personalMarks: { updateTag: vi.fn(), deleteTag: vi.fn() } } },
  orpc: { workspace: { personalMarks: { mine: { call: vi.fn() } } } },
}));

/**
 * 「# 태그」 목록 (설문 즐겨찾기·태그 티켓 09, 시안 F8-d) — 내 태그 전체를 많이 쓴 순·가나다순으로
 * 보고, 체크가 곧 검색창 칩이다. 붙은 설문이 0개인 태그도 나온다.
 */
const TAGS: PersonalTagItem[] = [
  { id: 't1', name: 'A사', color: 'blue', linkCount: 6 },
  { id: 't2', name: '2026', color: 'gray', linkCount: 23 },
  { id: 't3', name: '실태조사', color: 'green', linkCount: 17 },
  { id: 't4', name: '빈꼬리표', color: 'red', linkCount: 0 },
];

function setup(initial: string[] = []) {
  const onToggle = vi.fn();
  const onClear = vi.fn();
  function Harness() {
    // 체크 상태는 바깥(주소)이 정본이다 — 목록 화면과 같은 배선.
    const [selected, setSelected] = useState(initial);
    return (
      <TagFilterMenu
        tags={TAGS}
        selectedIds={selected}
        onToggle={(tagId, on) => {
          setSelected((prev) => (on ? [...prev, tagId] : prev.filter((id) => id !== tagId)));
          onToggle(tagId, on);
        }}
        onClearSelection={() => {
          setSelected([]);
          onClear();
        }}
      />
    );
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData<MinePersonalTagsOutput>(personalTagKeys.mine(), { tags: TAGS });
  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
  return { onToggle, onClear, user: userEvent.setup() };
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /태그/ }));
  return screen.getByRole('dialog', { name: '내 태그로 거르기' });
}

function rowNames() {
  return screen.getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'));
}

describe('TagFilterMenu', () => {
  it('누르면 목록이 열리고, 내 태그 수 안내와 함께 많이 쓴 순으로 0개짜리까지 모두 보인다', async () => {
    const { user } = setup();
    const dialog = await open(user);
    expect(within(dialog).getByText('내 태그 4개 · 나에게만 보입니다')).toBeInTheDocument();
    expect(rowNames()).toEqual(['2026', '실태조사', 'A사', '빈꼬리표']);
    // 줄마다 붙은 설문 수.
    expect(within(dialog).getByText('23')).toBeInTheDocument();
    expect(within(dialog).getByText('0')).toBeInTheDocument();
  });

  it('가나다순으로 바꿀 수 있다', async () => {
    const { user } = setup();
    await open(user);
    expect(screen.getByRole('button', { name: '많이 쓴 순' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: '가나다순' }));
    expect(screen.getByRole('button', { name: '가나다순' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(rowNames()).toEqual(['2026', '빈꼬리표', '실태조사', 'A사']);
  });

  it('태그 찾기 칸으로 좁힌다', async () => {
    const { user } = setup();
    await open(user);
    await user.type(screen.getByRole('textbox', { name: '태그 찾기' }), 'a사');
    expect(rowNames()).toEqual(['A사']);
  });

  it('걸린 태그는 체크되어 있고, 체크를 바꾸면 칩을 더하거나 뺀다 — 창은 열린 채', async () => {
    const { onToggle, user } = setup(['t1']);
    await open(user);
    expect(screen.getByRole('checkbox', { name: 'A사' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '2026' })).not.toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: '2026' }));
    expect(onToggle).toHaveBeenLastCalledWith('t2', true);
    expect(screen.getByRole('checkbox', { name: '2026' })).toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: 'A사' }));
    expect(onToggle).toHaveBeenLastCalledWith('t1', false);
    expect(screen.getByRole('dialog', { name: '내 태그로 거르기' })).toBeInTheDocument();
  });

  it('「선택 해제」는 걸린 칩을 모두 푼다 — 걸린 것이 없으면 없다', async () => {
    const { onClear, user } = setup(['t1', 't2']);
    await open(user);
    await user.click(screen.getByRole('button', { name: '선택 해제' }));
    expect(onClear).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: '선택 해제' })).toBeNull();
  });

  it('걸린 태그가 있으면 단추에 그 수가 보인다', () => {
    setup(['t1', 't2']);
    expect(screen.getByRole('button', { name: '태그 2' })).toBeInTheDocument();
  });

  it('줄마다 「⋯」 편집 단추가 있고 누르면 그 태그의 편집 패널이 열린다 — 체크는 그대로', async () => {
    const { onToggle, user } = setup();
    await open(user);
    await user.click(screen.getByRole('button', { name: '실태조사 편집' }));
    expect(screen.getByRole('button', { name: '실태조사 편집' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(await screen.findByRole('textbox', { name: '태그 이름' })).toHaveValue('실태조사');
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('편집 패널은 목록 전체의 옆에 선다 — 오른쪽 자리가 없어 뒤집혀도 목록을 덮지 않는다', async () => {
    const { user } = setup();
    const dialog = await open(user);
    const edit = screen.getByRole('button', { name: '실태조사 편집' });
    // 목록은 x 1000~1340, 「⋯」는 그 안 오른쪽 끝(1300). 화면(jsdom 1024)보다 오른쪽이라 패널은 왼쪽으로 뒤집힌다.
    stubRect(dialog, { left: 1000, top: 100, width: 340, height: 400 });
    stubRect(edit, { left: 1300, top: 260, width: 24, height: 24 });
    await user.click(edit);
    const nameInput = await screen.findByRole('textbox', { name: '태그 이름' });
    // 가장 가까운 data-side 는 Popup 이고, 자리를 잡는 것은 그 부모인 Positioner 다.
    const wrapper = nameInput.closest<HTMLElement>('[data-side]')?.parentElement ?? null;
    // 뒤집힌 패널의 오른쪽 끝이 「⋯」(1300)가 아니라 목록 왼쪽 끝(1000)에서 8px 띄운 자리다 — 줄 높이는 그 줄.
    await waitFor(() => expect(wrapper?.style.transform).toBe('translate(992px, 260px)'));
  });
});

function stubRect(el: Element, r: { left: number; top: number; width: number; height: number }) {
  const rect = {
    ...r,
    x: r.left,
    y: r.top,
    right: r.left + r.width,
    bottom: r.top + r.height,
    toJSON: () => r,
  };
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);
}
