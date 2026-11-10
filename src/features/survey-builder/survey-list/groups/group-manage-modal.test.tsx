/**
 * 그룹 관리 창 (3단계 중첩 티켓 07, 시안 G3).
 *
 * 팀의 그룹 전체를 들여쓰기 트리로 보이고 구조를 손보는 일을 한 창에서 한다 — 줄마다 끌기 손잡이 ·
 * 펼침 화살표 · 이름 · 건수 · ⋯ 메뉴(이름 바꾸기 · 하위 그룹 만들기 · 옮기기 · 삭제).
 *
 * 끌기는 jsdom 에서 일어나지 않는다(줄의 좌표가 전부 0이다). 그래서 끌기 영역(`DndContext`)이 받는
 * 「놓았다」 알림만 가로채 직접 부른다 — 끌기 영역 자체는 진짜 것이 그대로 돈다.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';
import { surveyGroupKeys } from '@/shared/lib/survey-group-queries';
import { surveyKeys } from '@/shared/lib/survey-list-queries';

import { GroupManageModal } from './group-manage-modal';

const TEAM = '22222222-2222-4222-8222-222222222222';
const G_LEE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const G_2026 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const G_H1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const G_H2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const G_2025 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
const G_2024 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6';
const G_KIM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7';
const G_KIM_2026 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8';
const G_ETC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9';
const G_FOREIGN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10';

type DragEnd = (event: { active: { id: string }; over: { id: string } | null }) => void;
const dnd = vi.hoisted(() => ({ onDragEnd: null as DragEnd | null }));
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...actual,
    DndContext: (props: React.ComponentProps<typeof actual.DndContext>) => {
      dnd.onDragEnd = props.onDragEnd as unknown as DragEnd;
      return <actual.DndContext {...props} />;
    },
  };
});

const createCall = vi.fn();
const renameCall = vi.fn();
const reorderCall = vi.fn();
const groupsCall = vi.fn();
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    workspace: {
      surveyGroups: {
        create: (...a: unknown[]) => createCall(...a),
        rename: (...a: unknown[]) => renameCall(...a),
        reorder: (...a: unknown[]) => reorderCall(...a),
      },
    },
  },
  orpc: {
    workspace: { surveyGroups: { list: { call: (...a: unknown[]) => groupsCall(...a) } } },
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function group(
  id: string,
  name: string,
  parentGroupId: string | null,
  surveyCount = 0,
  foreignTeamName: string | null = null,
): SurveyGroupListItem {
  return { id, name, order: 0, parentGroupId, surveyCount, foreignTeamName };
}

/**
 * 시안 G3 의 구조다. 건수는 서버가 준 값 그대로다(내 팀 그룹은 하위 그룹까지 합친 수).
 *
 *   이정운 34 ─ 2026 18 ─ 상반기 7 · 하반기 11
 *             ─ 2025 9
 *             ─ 2024 5
 *   김서연 21 ─ 2026 21
 *   기타 3
 *   (협업 그룹) 타 팀 폴더
 */
const NESTED: SurveyGroupListItem[] = [
  group(G_LEE, '이정운', null, 34),
  group(G_2026, '2026', G_LEE, 18),
  group(G_H1, '상반기', G_2026, 7),
  group(G_H2, '하반기', G_2026, 11),
  group(G_2025, '2025', G_LEE, 9),
  group(G_2024, '2024', G_LEE, 5),
  group(G_KIM, '김서연', null, 21),
  group(G_KIM_2026, '2026', G_KIM, 21),
  group(G_ETC, '기타', null, 3),
  group(G_FOREIGN, '타 팀 폴더', null, 2, '연구2본부'),
];

/** 하위 그룹을 만들지 않은 팀. */
const FLAT: SurveyGroupListItem[] = [
  group(G_LEE, '이정운', null, 4),
  group(G_KIM, '김서연', null, 2),
  group(G_ETC, '기타', null, 0),
];

function renderModal(groups: readonly SurveyGroupListItem[] = NESTED) {
  groupsCall.mockResolvedValue(groups);
  const onClose = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <GroupManageModal teamId={TEAM} groups={groups} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose, invalidate, dialog: screen.getByRole('dialog', { name: '그룹 관리' }) };
}

/** 그 이름의 그룹이 선 가지(줄 + 그 아래 하위 그룹). */
function branchOf(handleName: string): HTMLElement {
  const item = screen.getByRole('button', { name: handleName, hidden: true }).closest('li');
  if (!item) throw new Error(`${handleName} 의 줄을 찾지 못했다`);
  return item;
}

/** 창에 보이는 줄의 이름 — 위에서 아래로. 끌기 손잡이가 줄마다 하나씩 있다. */
function shownOrder(): string[] {
  return screen
    .getAllByRole('button', { name: / 순서 바꾸기$/, hidden: true })
    .map((handle) => (handle.getAttribute('aria-label') ?? '').replace(/ 순서 바꾸기$/, ''));
}

async function drop(activeId: string, overId: string | null) {
  await act(async () => {
    dnd.onDragEnd?.({ active: { id: activeId }, over: overId ? { id: overId } : null });
  });
}

async function openMenu(user: ReturnType<typeof userEvent.setup>, moreName: string) {
  await user.click(screen.getByRole('button', { name: moreName }));
  return screen.findByRole('menu');
}

beforeEach(() => {
  createCall.mockReset();
  renameCall.mockReset();
  reorderCall.mockReset();
  groupsCall.mockReset();
});

describe('GroupManageModal — 그룹 전체를 트리로 보인다', () => {
  it('세 단계의 그룹이 부모 밑에 들여쓰여 서고, 창을 열면 전부 펼쳐져 있다', () => {
    renderModal();

    expect(shownOrder()).toEqual([
      '이정운',
      '2026',
      '상반기',
      '하반기',
      '2025',
      '2024',
      '김서연',
      '2026',
      '기타',
    ]);
    // 하위 그룹은 부모의 가지 안에 있다.
    const lee = within(branchOf('이정운 순서 바꾸기'));
    expect(lee.getByText('상반기')).toBeInTheDocument();
    expect(lee.getByText('2024')).toBeInTheDocument();
    expect(lee.queryByText('김서연')).toBeNull();
    expect(screen.getByRole('button', { name: '이정운 접기' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('건수는 그룹 목록이 준 수(하위 포함)를 그대로 적는다', () => {
    renderModal();

    const lee = branchOf('이정운 순서 바꾸기');
    expect(within(lee).getByText('설문 34')).toBeInTheDocument();
    expect(within(lee).getByText('설문 18')).toBeInTheDocument();
    expect(within(lee).getByText('설문 7')).toBeInTheDocument();
  });

  it('협업 그룹(타 팀 폴더)은 이 창에 없다', () => {
    const { dialog } = renderModal();

    expect(within(dialog).queryByText('타 팀 폴더')).toBeNull();
  });

  it('화살표로 가지를 접고 편다 — 하위 그룹이 없는 줄에는 화살표가 없다', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('button', { name: '이정운 접기' }));

    expect(shownOrder()).toEqual(['이정운', '김서연', '2026', '기타']);
    const closed = screen.getByRole('button', { name: '이정운 펼치기' });
    expect(closed).toHaveAttribute('aria-expanded', 'false');

    await user.click(closed);
    expect(shownOrder()).toContain('상반기');

    expect(screen.queryByRole('button', { name: /^기타 (펼치기|접기)$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^상반기 (펼치기|접기)$/ })).toBeNull();
  });

  it('하위 그룹을 만들지 않은 팀은 화살표 없는 한 단 목록이다', () => {
    renderModal(FLAT);

    expect(shownOrder()).toEqual(['이정운', '김서연', '기타']);
    expect(screen.queryByRole('button', { name: /(펼치기|접기)$/ })).toBeNull();
    expect(screen.getAllByRole('list')).toHaveLength(1);
  });

  it('줄마다 있던 「설문 담기」 버튼은 없다 — 담기는 그룹 화면 머리에서 한다', () => {
    renderModal();

    expect(screen.queryByRole('button', { name: /설문 담기/ })).toBeNull();
  });

  it('이름이 겹칠 수 없는 범위를 같은 상위 그룹 기준으로 말한다', () => {
    const { dialog } = renderModal();

    expect(dialog).toHaveTextContent('같은 상위 그룹 안에서 겹칠 수 없습니다');
    expect(dialog).not.toHaveTextContent('팀 안에서 중복될 수 없습니다');
  });
});

describe('GroupManageModal — ⋯ 메뉴', () => {
  it('네 항목이 있다 — 이름 바꾸기 · 하위 그룹 만들기 · 옮기기 · 삭제', async () => {
    const user = userEvent.setup();
    renderModal();

    const menu = await openMenu(user, '이정운 더보기');

    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['이름 바꾸기', '하위 그룹 만들기', '옮기기', '삭제']);
    expect(within(menu).getByRole('menuitem', { name: '하위 그룹 만들기' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('3단계 줄의 「하위 그룹 만들기」는 꺼져 있다', async () => {
    const user = userEvent.setup();
    renderModal();

    const menu = await openMenu(user, '상반기 더보기');

    expect(within(menu).getByRole('menuitem', { name: '하위 그룹 만들기' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // 나머지 셋은 3단계에서도 된다.
    expect(within(menu).getByRole('menuitem', { name: '옮기기' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('「이름 바꾸기」가 그 그룹의 이름 창을 열고 새 이름을 보낸다', async () => {
    const user = userEvent.setup();
    renameCall.mockResolvedValue({ success: true });
    renderModal();

    await openMenu(user, '2025 더보기');
    await user.click(screen.getByRole('menuitem', { name: '이름 바꾸기' }));

    const nameDialog = await screen.findByRole('dialog', { name: '그룹 이름 바꾸기' });
    const input = within(nameDialog).getByRole('textbox', { name: '그룹 이름' });
    expect(input).toHaveValue('2025');
    await user.clear(input);
    await user.type(input, '2025 하반기');
    await user.click(within(nameDialog).getByRole('button', { name: '저장' }));

    await waitFor(() =>
      expect(renameCall).toHaveBeenCalledWith({ groupId: G_2025, name: '2025 하반기' }),
    );
  });

  it('「하위 그룹 만들기」가 그 줄 밑에 만든다 — 접혀 있던 줄은 펼쳐진다', async () => {
    const user = userEvent.setup();
    createCall.mockResolvedValue({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    renderModal();

    await user.click(screen.getByRole('button', { name: '김서연 접기' }));
    await openMenu(user, '김서연 더보기');
    await user.click(screen.getByRole('menuitem', { name: '하위 그룹 만들기' }));

    const nameDialog = await screen.findByRole('dialog', { name: '새 하위 그룹' });
    expect(nameDialog).toHaveTextContent('「김서연」 안에 만듭니다');
    await user.type(within(nameDialog).getByRole('textbox', { name: '그룹 이름' }), '2025');
    await user.click(within(nameDialog).getByRole('button', { name: '만들기' }));

    await waitFor(() =>
      expect(createCall).toHaveBeenCalledWith({ teamId: TEAM, name: '2025', parentGroupId: G_KIM }),
    );
    // 새 그룹이 설 자리가 보이도록 그 가지를 편다.
    expect(screen.getByRole('button', { name: '김서연 접기', hidden: true })).toBeInTheDocument();
  });

  it('「옮기기」가 옮기기 창을 그대로 연다 — 최상위 그룹도 옮길 수 있다', async () => {
    const user = userEvent.setup();
    renderModal();

    await openMenu(user, '기타 더보기');
    await user.click(screen.getByRole('menuitem', { name: '옮기기' }));

    const relocate = await screen.findByRole('dialog', { name: '「기타」 옮기기' });
    const places = within(relocate).getByRole('radiogroup', { name: '옮길 자리' });
    // 지금 최상위라 「최상위로」는 꺼져 있고, 다른 그룹 밑으로는 갈 수 있다.
    expect(within(places).getByRole('radio', { name: '최상위로 옮기기' })).toBeDisabled();
    expect(within(places).getByRole('radio', { name: '김서연' })).toBeEnabled();
    // 타 팀 폴더는 옮길 자리가 아니다.
    expect(within(places).queryByRole('radio', { name: '타 팀 폴더' })).toBeNull();
  });

  it('「삭제」가 올라갈 자리를 말하는 확인 창을 그대로 연다', async () => {
    const user = userEvent.setup();
    renderModal();

    // 「2026」은 이정운 밑에도 김서연 밑에도 있다 — 이정운 가지의 것을 지운다.
    await user.click(
      within(branchOf('이정운 순서 바꾸기')).getByRole('button', { name: '2026 더보기' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: '삭제' }));

    const confirm = await screen.findByRole('alertdialog', { name: '「2026」 그룹을 삭제할까요?' });
    await waitFor(() => expect(confirm).toHaveTextContent('한 단계 위 「이정운」 그룹으로'));
    // 건수는 확인 창에 적지 않는다.
    expect(confirm).not.toHaveTextContent('18');
  });
});

describe('GroupManageModal — 새 그룹', () => {
  it('「새 그룹」은 최상위 그룹을 만든다', async () => {
    const user = userEvent.setup();
    createCall.mockResolvedValue({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    renderModal();

    await user.click(screen.getByRole('button', { name: '새 그룹' }));
    await user.type(screen.getByRole('textbox', { name: '새 그룹 이름' }), '부서 공통');
    await user.click(screen.getByRole('button', { name: '추가' }));

    await waitFor(() =>
      expect(createCall).toHaveBeenCalledWith({ teamId: TEAM, name: '부서 공통' }),
    );
  });

  it('입력 줄에서 Esc 는 입력 줄만 접는다 — 창은 닫히지 않는다', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.click(screen.getByRole('button', { name: '새 그룹' }));
    await user.type(screen.getByRole('textbox', { name: '새 그룹 이름' }), '부서{Escape}');

    expect(screen.queryByRole('textbox', { name: '새 그룹 이름' })).toBeNull();
    expect(screen.getByRole('button', { name: '새 그룹' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(createCall).not.toHaveBeenCalled();
  });

  it('거부되면 서버의 문구를 보인다', async () => {
    const user = userEvent.setup();
    createCall.mockRejectedValue(new Error('같은 이름의 그룹이 이미 있습니다.'));
    renderModal();

    await user.click(screen.getByRole('button', { name: '새 그룹' }));
    await user.type(screen.getByRole('textbox', { name: '새 그룹 이름' }), '기타{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('같은 이름의 그룹이 이미 있습니다.');
  });
});

describe('GroupManageModal — 끌어서 순서 바꾸기', () => {
  it('같은 부모 안에서 놓으면 그 부모와 형제 id 만 보내고, 응답을 기다리지 않고 새 순서로 그린다', async () => {
    let settle: (value: unknown) => void = () => {};
    reorderCall.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    const { invalidate } = renderModal();

    await drop(G_2024, G_2026);

    expect(reorderCall).toHaveBeenCalledWith({
      teamId: TEAM,
      parentGroupId: G_LEE,
      orderedGroupIds: [G_2024, G_2026, G_2025],
    });
    // 하위 그룹은 부모를 따라간다.
    expect(shownOrder()).toEqual([
      '이정운',
      '2024',
      '2026',
      '상반기',
      '하반기',
      '2025',
      '김서연',
      '2026',
      '기타',
    ]);

    await act(async () => settle({ success: true }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: surveyGroupKeys.all }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: surveyKeys.lists() });
  });

  it('최상위끼리는 부모 없이(null) 최상위 id 만 보낸다', async () => {
    reorderCall.mockResolvedValue({ success: true });
    renderModal();

    await drop(G_ETC, G_LEE);

    expect(reorderCall).toHaveBeenCalledWith({
      teamId: TEAM,
      parentGroupId: null,
      orderedGroupIds: [G_ETC, G_LEE, G_KIM],
    });
  });

  it('다른 부모의 줄 위에 놓으면 아무것도 보내지 않고 순서도 그대로다', async () => {
    renderModal();
    const before = shownOrder();

    await drop(G_2025, G_KIM_2026);
    await drop(G_H1, G_2025);
    await drop(G_2025, null);

    expect(reorderCall).not.toHaveBeenCalled();
    expect(shownOrder()).toEqual(before);
  });

  it('거부되면 사유를 보이고 미리 그린 순서를 걷으며, 그룹 목록을 다시 읽는다', async () => {
    reorderCall.mockRejectedValue(new Error('다른 사람이 그룹 구조를 바꿨습니다.'));
    const { invalidate } = renderModal();
    const before = shownOrder();

    await drop(G_2024, G_2026);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '다른 사람이 그룹 구조를 바꿨습니다.',
    );
    expect(shownOrder()).toEqual(before);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: surveyGroupKeys.all });
  });
});

describe('GroupManageModal — 닫기', () => {
  it('아래 「닫기」로 창을 닫는다', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.click(screen.getByRole('button', { name: '닫기' }));

    expect(onClose).toHaveBeenCalled();
  });
});
