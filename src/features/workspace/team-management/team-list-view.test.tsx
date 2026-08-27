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
});
