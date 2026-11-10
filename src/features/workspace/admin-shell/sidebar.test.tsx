/**
 * 실사팀 사이드바 분기 (0139, .pen 사이드바_협업그룹_시안 「방식 A'」).
 *
 * 실사팀 범위에서만 「설문 목록」·그룹 트리 대신 「참여 중」 + 소유 팀 줄을 그린다. 일반 팀은
 * 종전 그대로다. 수치는 응답 수 없는 요약 조회(read.listSummaries)에서 센다 — 서버가 목록과 같은
 * 범위 조건을 쓰므로 본문 카드 수와 같다(설문 즐겨찾기·태그 티켓 02).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TeamKind } from '@/shared/contracts/workspace';
import { surveyGroupKeys } from '@/shared/lib/survey-group-queries';
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
  return {
    id: crypto.randomUUID(),
    title: '설문',
    cardTitle: null,
    teamId,
    teamName,
    surveyGroupId,
  };
}

function sidebarUi(kind: TeamKind, queryClient: QueryClient) {
  return (
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
    </QueryClientProvider>
  );
}

function renderSidebar(kind: TeamKind) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(sidebarUi(kind, queryClient));
  return {
    queryClient,
    /** 주소가 바뀐 뒤 같은 사이드바를 다시 그린다 — 사이드바는 레이아웃에 있어 화면을 옮겨도 남는다. */
    navigate(params: Record<string, string>) {
      searchParams = new URLSearchParams(params);
      view.rerender(sidebarUi(kind, queryClient));
    },
  };
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
 * 일반 팀의 그룹 트리 (3단계 중첩 티켓 03, 시안 G1·G2 왼쪽 사이드바).
 *
 * 내 팀 그룹은 트리로 서고 지금 들어가 있는 가지만 펼쳐진다. 협업 그룹(타 팀 폴더)은 그 아래에
 * 종전 모양 그대로 평평하게 선다 — 서버가 상위 그룹을 알려 주지 않는 줄이다.
 */
describe('일반 팀 사이드바의 그룹 트리', () => {
  function g(id: string, name: string, parentGroupId: string | null, surveyCount = 1) {
    return { id, name, order: 0, parentGroupId, surveyCount, foreignTeamName: null };
  }

  const NESTED = [
    g('g-lee', '이정운', null, 34),
    g('g-kim', '김서연', null, 21),
    g('g-etc', '기타', null, 3),
    g('g-lee-2026', '2026', 'g-lee', 18),
    g('g-lee-2025', '2025', 'g-lee', 12),
    g('g-lee-2026-h1', '상반기', 'g-lee-2026', 7),
    g('g-lee-2026-h2', '하반기', 'g-lee-2026', 6),
    g('g-kim-2024', '2024', 'g-kim', 9),
  ];

  const tree = () => screen.findByRole('list', { name: '설문 그룹' });

  beforeEach(() => {
    groupsCall.mockResolvedValue(NESTED);
  });

  it('같은 이름의 하위 그룹은 펼침 단추의 읽어 주는 이름이 경로로 갈린다', async () => {
    groupsCall.mockResolvedValue([
      ...NESTED,
      g('g-kim-2026', '2026', 'g-kim', 4),
      g('g-kim-2026-h1', '상반기', 'g-kim-2026', 2),
    ]);
    searchParams = new URLSearchParams({ group: 'g-lee-2026-h1' });
    renderSidebar('standard');

    expect(await screen.findByRole('button', { name: '이정운 › 2026 접기' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '김서연 펼치기' }));
    expect(screen.getByRole('button', { name: '김서연 › 2026 펼치기' })).toBeInTheDocument();
    // 최상위 그룹의 이름은 그대로이고, 줄에 보이는 글자도 바뀌지 않는다.
    expect(screen.getByRole('button', { name: '이정운 접기' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /^2026/ })).toHaveLength(2);
  });

  it('3단계 그룹 화면이면 그 위 두 단계가 펼쳐져 있고 다른 가지는 접혀 있다', async () => {
    searchParams = new URLSearchParams({ group: 'g-lee-2026-h1' });
    renderSidebar('standard');

    expect(await screen.findByRole('link', { name: /상반기/ })).toHaveAttribute(
      'href',
      '/surveys?group=g-lee-2026-h1',
    );
    expect(screen.getByRole('button', { name: '이정운 접기' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: '이정운 › 2026 접기' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    // 같은 가지의 형제는 함께 보인다.
    expect(screen.getByRole('link', { name: /하반기/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /2025/ })).toBeInTheDocument();

    // 다른 가지는 접힌 채다.
    expect(screen.getByRole('button', { name: '김서연 펼치기' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('link', { name: /2024/ })).toBeNull();

    // 켜진 줄은 지금 그룹 하나다 — 위쪽 그룹은 펼쳐져 있을 뿐 켜지지 않는다.
    expect(screen.getByRole('link', { name: /상반기/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /이정운/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: /2026/ })).not.toHaveAttribute('aria-current');
  });

  it('지금 그룹 자신도 펼쳐져 하위 그룹을 보인다', async () => {
    searchParams = new URLSearchParams({ group: 'g-lee' });
    renderSidebar('standard');

    expect(await screen.findByRole('link', { name: /2026/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /이정운/ })).toHaveAttribute('aria-current', 'page');
    // 한 단계 아래까지만 — 그 밑은 화살표로 연다.
    expect(screen.queryByRole('link', { name: /상반기/ })).toBeNull();
  });

  it('그룹 화면이 아니면 맨 위 그룹만 보이고 전부 접혀 있다', async () => {
    renderSidebar('standard');

    expect(await screen.findByRole('link', { name: /이정운/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /김서연/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /2026/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /상반기/ })).toBeNull();
  });

  it('화살표를 누르면 그 가지가 펼쳐지고 다시 누르면 접힌다', async () => {
    renderSidebar('standard');
    const toggle = await screen.findByRole('button', { name: '김서연 펼치기' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(toggle);

    expect(screen.getByRole('button', { name: '김서연 접기' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('link', { name: /2024/ })).toHaveAttribute(
      'href',
      '/surveys?group=g-kim-2024',
    );

    await userEvent.click(screen.getByRole('button', { name: '김서연 접기' }));

    expect(screen.getByRole('button', { name: '김서연 펼치기' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('link', { name: /2024/ })).toBeNull();
  });

  it('하위 그룹이 없는 줄에는 화살표가 없다', async () => {
    renderSidebar('standard');
    await screen.findByRole('link', { name: /기타/ });

    expect(screen.queryByRole('button', { name: /기타/ })).toBeNull();
  });

  it('하위 그룹이 없는 팀은 화살표 없는 한 단 목록이다', async () => {
    groupsCall.mockResolvedValue([g('g-a', '2025 조사', null), g('g-b', '2026 조사', null)]);
    renderSidebar('standard');

    const list = await tree();
    expect(within(list).getAllByRole('link')).toHaveLength(2);
    expect(within(list).queryByRole('button')).toBeNull();
    expect(within(list).queryAllByRole('list')).toHaveLength(0);
  });

  it('줄마다 건수가 붙고 전체 이름을 툴팁으로 낸다', async () => {
    const longName = '2026년 상반기 공공기관 고객만족도 조사 묶음';
    groupsCall.mockResolvedValue([g('g-long', longName, null, 12)]);
    renderSidebar('standard');

    const link = await screen.findByRole('link', { name: new RegExp(longName) });
    expect(link).toHaveAttribute('title', longName);
    expect(link).toHaveTextContent('12');
  });

  it('접어 둔 가지라도 그 안의 그룹으로 옮겨 가면 다시 펼쳐진다', async () => {
    searchParams = new URLSearchParams({ group: 'g-lee-2026-h1' });
    const { navigate } = renderSidebar('standard');

    await userEvent.click(await screen.findByRole('button', { name: '이정운 접기' }));
    expect(screen.queryByRole('link', { name: /상반기/ })).toBeNull();
    // 다른 가지를 손으로 펼쳐 둔다.
    await userEvent.click(screen.getByRole('button', { name: '김서연 펼치기' }));

    navigate({ group: 'g-lee-2026-h2' });

    expect(screen.getByRole('link', { name: /하반기/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: '이정운 접기' })).toBeInTheDocument();
    // 손으로 펼친 다른 가지는 화면을 옮겨도 그대로다.
    expect(screen.getByRole('link', { name: /2024/ })).toBeInTheDocument();
  });

  it('하위 그룹을 만든 뒤 그룹 목록을 무효화하면 새 구조를 보인다', async () => {
    groupsCall.mockResolvedValue([g('g-a', '이정운', null)]);
    searchParams = new URLSearchParams({ group: 'g-a' });
    const { queryClient } = renderSidebar('standard');
    await screen.findByRole('link', { name: /이정운/ });
    expect(screen.queryByRole('button', { name: /이정운/ })).toBeNull();

    groupsCall.mockResolvedValue([g('g-a', '이정운', null), g('g-a-2026', '2026', 'g-a')]);
    // 그룹 mutation 이 정착 뒤에 하는 무효화 그대로다(use-survey-groups).
    await queryClient.invalidateQueries({ queryKey: surveyGroupKeys.all });

    expect(await screen.findByRole('link', { name: /2026/ })).toHaveAttribute(
      'href',
      '/surveys?group=g-a-2026',
    );
    expect(screen.getByRole('button', { name: '이정운 접기' })).toBeInTheDocument();
  });

  it('상위 그룹이 목록에 없는 그룹도 맨 위 줄로 선다', async () => {
    groupsCall.mockResolvedValue([g('g-orphan', '2025', 'g-hidden')]);
    renderSidebar('standard');

    expect(await screen.findByRole('link', { name: /2025/ })).toBeInTheDocument();
  });

  describe('협업 그룹', () => {
    const foreign = (id: string, name: string, teamName: string) => ({
      ...g(id, name, null, 2),
      foreignTeamName: teamName,
    });

    it('트리 밖에 평평하게, 소유 팀 이름과 함께 선다', async () => {
      // 서버가 준 순서가 섞여 있어도 트리에 끼지 않는다.
      groupsCall.mockResolvedValue([
        foreign('g-f1', '상반기', '연구3본부 5팀'),
        ...NESTED,
        foreign('g-f2', '패널 조사', '연구1본부 1팀'),
      ]);
      renderSidebar('standard');

      const collab = await screen.findByRole('list', { name: '협업 그룹' });
      const links = within(collab).getAllByRole('link');
      expect(links).toHaveLength(2);
      expect(links[0]).toHaveAttribute('href', '/surveys?group=g-f1');
      expect(links[0]).toHaveTextContent('상반기');
      expect(links[0]).toHaveTextContent('연구3본부 5팀');
      expect(links[0]).toHaveAttribute('title', '상반기 · 연구3본부 5팀');
      expect(links[1]).toHaveTextContent('연구1본부 1팀');
      // 평평하다 — 화살표도 안쪽 목록도 없다.
      expect(within(collab).queryByRole('button')).toBeNull();
      expect(within(collab).queryAllByRole('list')).toHaveLength(0);

      const own = await tree();
      expect(within(own).queryByRole('link', { name: /연구3본부 5팀/ })).toBeNull();
      expect(within(own).queryByRole('link', { name: /패널 조사/ })).toBeNull();
    });

    it('협업 그룹 화면에 있으면 그 줄이 켜지고 내 팀 가지는 펼쳐지지 않는다', async () => {
      groupsCall.mockResolvedValue([...NESTED, foreign('g-f1', '패널 조사', '연구1본부 1팀')]);
      searchParams = new URLSearchParams({ group: 'g-f1' });
      renderSidebar('standard');

      expect(await screen.findByRole('link', { name: /패널 조사/ })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(screen.queryByRole('link', { name: /2026/ })).toBeNull();
    });

    it('협업 그룹만 보이는 팀은 내 팀 트리 없이 그 줄만 선다', async () => {
      groupsCall.mockResolvedValue([foreign('g-f1', '패널 조사', '연구1본부 1팀')]);
      renderSidebar('standard');

      expect(await screen.findByRole('list', { name: '협업 그룹' })).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: '설문 그룹' })).toBeNull();
    });
  });
});
