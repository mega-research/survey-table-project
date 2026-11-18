/**
 * 카드 케밥의 「그룹 이동」 메뉴 (3단계 중첩 티켓 04).
 *
 * 그룹을 들여쓰기 트리로 보여 주고 어느 단계든 고른다. 「미분류」는 빼기다. 하위 그룹을 만들지
 * 않은 팀의 메뉴는 전과 같은 한 단 목록이어야 한다.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';

import { GroupMoveSubmenu } from './group-move-submenu';

function group(id: string, name: string, parentGroupId: string | null): SurveyGroupListItem {
  return { id, name, order: 0, parentGroupId, surveyCount: 0, foreignTeamName: null };
}

const NESTED: SurveyGroupListItem[] = [
  group('lee', '이정운', null),
  group('lee-2026', '2026', 'lee'),
  group('lee-2026-h1', '상반기', 'lee-2026'),
  group('lee-2025', '2025', 'lee'),
  group('kim', '김서연', null),
  group('kim-2025', '2025', 'kim'),
];

const FLAT: SurveyGroupListItem[] = [group('a', '2025', null), group('b', '2026 상반기', null)];

/** 케밥을 열고 「그룹 이동」 서브메뉴까지 펼친다 — 펼쳐진 패널(그룹 줄 묶음)을 돌려준다. */
async function openMoveMenu(
  groups: SurveyGroupListItem[],
  currentGroupId: string | null,
  onMove = vi.fn(),
) {
  const user = userEvent.setup();
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>더보기</DropdownMenuTrigger>
      <DropdownMenuContent>
        <GroupMoveSubmenu
          groups={groups}
          currentGroupId={currentGroupId}
          disabled={false}
          onMove={onMove}
        />
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  await user.click(screen.getByRole('button', { name: '더보기' }));
  // 서브메뉴는 자판으로 연다. 마우스를 올려 열면 Base UI 가 「메뉴로 건너가는 길」을 지키느라 잠깐
  // 다른 곳의 포인터를 막는데, jsdom 에는 그 길을 지나는 마우스 움직임이 없어 막힌 채로 남는다.
  (await screen.findByRole('menuitem', { name: '그룹 이동' })).focus();
  await user.keyboard('{ArrowRight}');
  const panel = await screen.findByRole('group', { name: '그룹 이동' });
  return { user, onMove, panel };
}

/** 메뉴의 그룹 줄 — 「들여쓰기 단:이름」. */
function rows(panel: HTMLElement): string[] {
  return within(panel)
    .getAllByRole('menuitem')
    .map((item) => `${item.dataset['depth']}:${item.textContent}`);
}

describe('「그룹 이동」 메뉴 — 들여쓰기 트리', () => {
  it('그룹이 가지째 묶여 단마다 들여쓰기된다', async () => {
    const { panel } = await openMoveMenu(NESTED, null);

    expect(rows(panel)).toEqual(['1:이정운', '2:2026', '3:상반기', '2:2025', '1:김서연', '2:2025']);
    // 들여쓰기는 단이 깊을수록 커진다.
    const indent = (name: string) =>
      Number.parseInt(within(panel).getByRole('menuitem', { name }).style.paddingLeft || '0', 10);
    expect(indent('이정운 › 2026')).toBeGreaterThan(indent('이정운'));
    expect(indent('이정운 › 2026 › 상반기')).toBeGreaterThan(indent('이정운 › 2026'));
  });

  it('3단계 그룹을 고르면 그 그룹으로 옮긴다', async () => {
    const { user, onMove, panel } = await openMoveMenu(NESTED, null);

    await user.click(within(panel).getByRole('menuitem', { name: '이정운 › 2026 › 상반기' }));

    expect(onMove).toHaveBeenCalledExactlyOnceWith('lee-2026-h1');
  });

  it('같은 이름의 하위 그룹은 위쪽 경로로 갈린다', async () => {
    const { user, onMove, panel } = await openMoveMenu(NESTED, null);

    await user.click(within(panel).getByRole('menuitem', { name: '김서연 › 2025' }));

    expect(onMove).toHaveBeenCalledExactlyOnceWith('kim-2025');
  });

  it('지금 담긴 그룹은 표시돼 있다 — 하위 그룹이어도', async () => {
    const { panel } = await openMoveMenu(NESTED, 'lee-2026');

    const current = within(panel).getByRole('menuitem', { name: '이정운 › 2026' });
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(within(panel).getAllByRole('menuitem', { current: true })).toHaveLength(1);
  });

  it('「미분류」를 고르면 그룹에서 뺀다', async () => {
    const { user, onMove } = await openMoveMenu(NESTED, 'lee-2026-h1');

    await user.click(screen.getByRole('menuitem', { name: /미분류로 이동/ }));

    expect(onMove).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('이미 미분류인 설문은 「미분류로 이동」이 꺼져 있다', async () => {
    await openMoveMenu(NESTED, null);

    expect(screen.getByRole('menuitem', { name: /미분류로 이동/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});

describe('「그룹 이동」 메뉴 — 하위 그룹을 만들지 않은 팀', () => {
  it('전과 같은 한 단 목록이다 — 들여쓰기가 없다', async () => {
    const { panel } = await openMoveMenu(FLAT, 'a');

    expect(rows(panel)).toEqual(['1:2025', '1:2026 상반기']);
    for (const item of within(panel).getAllByRole('menuitem')) {
      expect(item.style.paddingLeft).toBe('');
    }
  });

  it('그룹이 없으면 안내 한 줄만 있다', async () => {
    const { panel } = await openMoveMenu([], null);

    expect(within(panel).getByText('아직 만든 그룹이 없습니다.')).toBeInTheDocument();
    expect(within(panel).queryAllByRole('menuitem')).toHaveLength(0);
  });
});
