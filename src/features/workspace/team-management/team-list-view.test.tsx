/**
 * 팀 관리 목록 (.pen FLOW 7-1) — 해산 진입점이 **팀 카드에만** 있는가.
 *
 * 「메가리서치」는 팀이 아니라 시스템 전체 보기라 teams 행이 없다(ADR-0006). 케밥이 붙는
 * 순간 해산 대상처럼 읽히므로 그 카드에는 케밥 자체가 없어야 한다. 목록 화면에서 고정할
 * 값은 그 갈림과 「해산 → 확인 모달」 연결 두 개다 — 확정 로직은 모달과 서버가 진다.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useTeams } = vi.hoisted(() => ({ useTeams: vi.fn() }));

vi.mock('./queries/use-teams', () => ({
  useTeams,
  useDissolveTeam: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { TeamListView } from './team-list-view';

const TEAM = {
  id: '22222222-2222-4222-8222-222222222222',
  name: '연구1본부 - 1팀',
  memberCount: 3,
  surveyCount: 8,
};

beforeEach(() => {
  vi.clearAllMocks();
  useTeams.mockReturnValue({
    data: { teams: [TEAM], systemSummary: { teamCount: 1, surveyCount: 8 } },
    isLoading: false,
    error: null,
  });
});

describe('TeamListView — 해산 진입점', () => {
  it('메가리서치 카드에는 케밥이 없고 팀 카드에만 있다', () => {
    render(<TeamListView />);

    expect(screen.getByText('메가리서치')).toBeInTheDocument();
    // 케밥은 팀 이름으로 라벨링된다 — 팀 수만큼만 존재해야 한다.
    const kebabs = screen.getAllByRole('button', { name: /메뉴$/ });
    expect(kebabs).toHaveLength(1);
    expect(kebabs[0]).toHaveAccessibleName(`${TEAM.name} 메뉴`);
  });

  it('케밥의 「팀 해산…」이 확인 모달을 연다', async () => {
    const user = userEvent.setup();
    render(<TeamListView />);

    await user.click(screen.getByRole('button', { name: `${TEAM.name} 메뉴` }));

    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('팀 상세')).toBeInTheDocument();
    await user.click(within(menu).getByText('팀 해산…'));

    // 확인 모달이 뜨고, 되돌릴 수 없다는 사실을 먼저 말한다.
    expect(await screen.findByText(/되돌릴 수 없습니다/)).toBeInTheDocument();
    expect(screen.getByLabelText('확인을 위해 팀 이름을 입력하세요')).toBeInTheDocument();
  });

  it('모달은 목록 스냅샷이 아니라 최신 행을 본다', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<TeamListView />);

    await user.click(screen.getByRole('button', { name: `${TEAM.name} 메뉴` }));
    await user.click(within(await screen.findByRole('menu')).getByText('팀 해산…'));
    // 카드에도 같은 이름이 있으므로 다이얼로그 안에서만 본다.
    expect((await screen.findByRole('dialog')).textContent).toContain(TEAM.name);

    // 열어둔 사이 다른 관리자가 이름을 바꿨다. 객체 스냅샷을 붙들고 있으면 모달은 옛 이름을
    // 보여주고 서버는 그 이름을 거부한다 — 화면이 방금 자기가 보여준 문자열을 거부하는 셈이다.
    const renamed = { ...TEAM, name: '연구1본부 - 통합1팀', memberCount: 5 };
    useTeams.mockReturnValue({
      data: { teams: [renamed], systemSummary: { teamCount: 1, surveyCount: 8 } },
      isLoading: false,
      error: null,
    });
    rerender(<TeamListView />);

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(renamed.name);
    expect(within(dialog).getByText(/팀원 5명이 미배치로 전환됩니다/)).toBeInTheDocument();
    // 확인란의 placeholder 도 최신 이름이어야 한다 — 옛 이름을 따라 치면 서버가 거부한다.
    expect(within(dialog).getByLabelText('확인을 위해 팀 이름을 입력하세요')).toHaveAttribute(
      'placeholder',
      renamed.name,
    );
  });
});
