/**
 * 실사팀 사이드바 분기 (0139, .pen 사이드바_협업그룹_시안 「방식 A'」).
 *
 * 실사팀 범위에서만 「설문 목록」·그룹 트리 대신 「참여 중」 + 소유 팀 줄을 그린다. 일반 팀은
 * 종전 그대로다. 수치는 응답 수 없는 요약 조회(read.listSummaries)에서 센다 — 서버가 목록과 같은
 * 범위 조건을 쓰므로 본문 카드 수와 같다(설문 즐겨찾기·태그 티켓 02).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TeamKind } from '@/shared/contracts/workspace';
import { WorkScopeContext } from '@/shared/lib/work-scope-context';

import { Sidebar } from './sidebar';

const FIELDWORK_TEAM = '99999999-9999-4999-8999-999999999999';
const TEAM_5 = '55555555-5555-4555-8555-555555555555';
const TEAM_1 = '11111111-1111-4111-8111-111111111111';

let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/surveys',
  useSearchParams: () => searchParams,
}));

const listCall = vi.fn();
const summariesCall = vi.fn();
const groupsCall = vi.fn();
vi.mock('@/shared/lib/rpc', () => ({
  client: {},
  orpc: {
    surveyBuilder: {
      read: {
        list: { call: (...a: unknown[]) => listCall(...a) },
        listSummaries: { call: (...a: unknown[]) => summariesCall(...a) },
      },
    },
    workspace: { surveyGroups: { list: { call: (...a: unknown[]) => groupsCall(...a) } } },
  },
}));

function s(teamId: string, teamName: string, surveyGroupId: string | null) {
  return { id: crypto.randomUUID(), title: '설문', cardTitle: null, teamId, teamName, surveyGroupId };
}

function renderSidebar(kind: TeamKind) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkScopeContext.Provider
        value={{
          scope: { kind: 'team', teamId: FIELDWORK_TEAM },
          teams: [{ id: FIELDWORK_TEAM, name: '실사팀', kind }],
          canSeeSystemScope: false,
          isSuperadmin: false,
          currentUserId: 'u-1',
          leaderTeamIds: [],
          setScope: vi.fn(),
        }}
      >
        <Sidebar
          user={{ name: '이승민', isSuperadmin: false, image: null }}
          memberships={[{ teamId: FIELDWORK_TEAM, role: 'member' }]}
          collapsed={false}
          onToggle={vi.fn()}
        />
      </WorkScopeContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  searchParams = new URLSearchParams();
  listCall.mockReset();
  summariesCall.mockReset();
  summariesCall.mockResolvedValue([
    s(TEAM_5, '연구3본부 5팀', 'g-2026'),
    s(TEAM_5, '연구3본부 5팀', 'g-2026'),
    s(TEAM_5, '연구3본부 5팀', null),
    s(TEAM_1, '연구1본부 1팀', null),
  ]);
  groupsCall.mockResolvedValue([
    {
      id: 'g-2026',
      name: '2026',
      order: 0,
      parentGroupId: null,
      surveyCount: 2,
      foreignTeamName: '연구3본부 5팀',
    },
  ]);
});

describe('실사팀 사이드바', () => {
  it('설문 목록 대신 참여 중과 소유 팀 줄을 그린다', async () => {
    renderSidebar('fieldwork');

    expect(await screen.findByRole('link', { name: /참여 중/ })).toHaveAttribute(
      'href',
      '/surveys',
    );
    expect(screen.queryByRole('link', { name: '설문 목록' })).toBeNull();
    expect(await screen.findByRole('link', { name: /연구3본부 5팀/ })).toHaveAttribute(
      'href',
      `/surveys?team=${TEAM_5}`,
    );
    expect(screen.getByRole('link', { name: /연구1본부 1팀/ })).toBeInTheDocument();
    // 참여 중 수 배지는 본문 목록과 같은 수다.
    expect(screen.getByRole('link', { name: /참여 중/ })).toHaveTextContent('4');
  });

  it('응답 수를 세는 목록 조회 대신 그 팀 범위의 요약 조회를 부른다', async () => {
    renderSidebar('fieldwork');
    await screen.findByRole('link', { name: /연구3본부 5팀/ });
    expect(summariesCall).toHaveBeenCalledWith({ scope: FIELDWORK_TEAM });
    expect(listCall).not.toHaveBeenCalled();
  });

  it('팀 줄의 화살표로 그 팀 폴더와 미분류를 펼친다', async () => {
    renderSidebar('fieldwork');
    await screen.findByRole('link', { name: /연구3본부 5팀/ });
    expect(screen.queryByRole('link', { name: /2026/ })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: '연구3본부 5팀 펼치기' }));

    expect(screen.getByRole('link', { name: /2026/ })).toHaveAttribute(
      'href',
      '/surveys?group=g-2026',
    );
    expect(screen.getByRole('link', { name: /미분류/ })).toHaveAttribute(
      'href',
      `/surveys?team=${TEAM_5}&ungrouped=1`,
    );
  });

  it('지금 보고 있는 팀은 펼친 채로 시작한다', async () => {
    searchParams = new URLSearchParams({ team: TEAM_5 });
    renderSidebar('fieldwork');
    expect(await screen.findByRole('link', { name: /2026/ })).toBeInTheDocument();
  });

  it('일반 팀은 종전대로 설문 목록을 그린다', async () => {
    renderSidebar('standard');
    expect(screen.getByRole('link', { name: '설문 목록' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /참여 중/ })).toBeNull();
  });
});

/**
 * 일반 팀의 그룹 줄 (3단계 중첩 티켓 01) — 사이드바는 아직 맨 위 그룹만 그린다. 하위 그룹은
 * 본문의 폴더 줄로 들어가고, 하위 그룹 화면에 있으면 그 가지의 맨 위 줄이 켜진다.
 */
describe('일반 팀 사이드바의 그룹 줄', () => {
  function g(id: string, name: string, parentGroupId: string | null) {
    return { id, name, order: 0, parentGroupId, surveyCount: 1, foreignTeamName: null };
  }

  beforeEach(() => {
    groupsCall.mockResolvedValue([
      g('g-lee', '이정운', null),
      g('g-kim', '김서연', null),
      g('g-lee-2026', '2026', 'g-lee'),
      g('g-lee-2026-h1', '상반기', 'g-lee-2026'),
    ]);
  });

  it('맨 위 그룹만 줄로 서고 하위 그룹은 줄이 없다', async () => {
    renderSidebar('standard');

    expect(await screen.findByRole('link', { name: /이정운/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /김서연/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /2026/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /상반기/ })).toBeNull();
  });

  it('하위 그룹 화면에 있으면 그 가지의 맨 위 그룹 줄이 켜진다', async () => {
    searchParams = new URLSearchParams({ group: 'g-lee-2026-h1' });
    renderSidebar('standard');

    expect(await screen.findByRole('link', { name: /이정운/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('link', { name: /김서연/ })).not.toHaveAttribute('aria-current');
  });

  it('맨 위 그룹 화면에 있으면 그 줄이 지금 화면이다', async () => {
    searchParams = new URLSearchParams({ group: 'g-kim' });
    renderSidebar('standard');

    expect(await screen.findByRole('link', { name: /김서연/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: /이정운/ })).not.toHaveAttribute('aria-current');
  });

  it('상위 그룹이 목록에 없는 그룹도 한 줄로 선다', async () => {
    groupsCall.mockResolvedValue([g('g-orphan', '2025', 'g-hidden')]);
    renderSidebar('standard');

    expect(await screen.findByRole('link', { name: /2025/ })).toBeInTheDocument();
  });
});
