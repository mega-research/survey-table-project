/**
 * 설문 목록의 그룹 화면 (3단계 중첩 티켓 01, 시안 G1·G2).
 *
 * 그룹 화면은 `?group=<id>` 라는 주소다. 여기서 보는 것은 그 주소가 그리는 뼈대다 — 브레드크럼,
 * 하위 그룹 폴더 줄, 「새 하위 그룹」(1·2단계에만). 그리고 하위 그룹을 만들지 않은 팀의 그룹
 * 화면이 전과 같다는 것(폴더 줄 영역이 없다).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  SurveyListPageItem,
  SurveyListPageResult,
} from '@/shared/contracts/survey-builder-io';
import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';
import { surveyGroupKeys } from '@/shared/lib/survey-group-queries';
import { WorkScopeContext } from '@/shared/lib/work-scope-context';

import { SurveyListView } from './survey-list-view';

const TEAM = '22222222-2222-4222-8222-222222222222';
const G_LEE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const G_2026 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const G_2025 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const G_H1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const G_FOREIGN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';

let searchParams = new URLSearchParams();
const routerReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: routerReplace }),
  usePathname: () => '/surveys',
  useSearchParams: () => searchParams,
}));

const listPageCall = vi.fn();
const groupsCall = vi.fn();
const removeGroupCall = vi.fn();
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    workspace: { surveyGroups: { remove: (...a: unknown[]) => removeGroupCall(...a) } },
  },
  orpc: {
    surveyBuilder: { read: { listPage: { call: (...a: unknown[]) => listPageCall(...a) } } },
    workspace: {
      surveyGroups: { list: { call: (...a: unknown[]) => groupsCall(...a) } },
      personalMarks: { mine: { call: async () => ({ tags: [], favoriteCount: 0 }) } },
    },
  },
}));

function group(
  id: string,
  name: string,
  parentGroupId: string | null,
  over: Partial<SurveyGroupListItem> = {},
): SurveyGroupListItem {
  return { id, name, order: 0, parentGroupId, surveyCount: 0, foreignTeamName: null, ...over };
}

// 건수는 서버가 준 값 그대로다 — 내 팀 그룹은 하위 그룹까지 합친 수(이정운 34 = 직접 4 + 2026 18 + 2025 12).
const NESTED: SurveyGroupListItem[] = [
  group(G_LEE, '이정운', null, { surveyCount: 34 }),
  group(G_2026, '2026', G_LEE, { surveyCount: 18 }),
  group(G_2025, '2025', G_LEE, { surveyCount: 12 }),
  group(G_H1, '상반기', G_2026, { surveyCount: 7 }),
  group(G_FOREIGN, 'A고객사 2026', null, { surveyCount: 2, foreignTeamName: '연구1본부 1팀' }),
];

/** 설문이 없는 그룹 한 쪽 — 뼈대만 보므로 카드는 필요 없다. */
const EMPTY_PAGE: SurveyListPageResult = {
  scope: { kind: 'team', teamId: TEAM },
  teams: [],
  canSeeSystemScope: false,
  deletedCount: null,
  items: [],
  total: 0,
  page: 1,
  totalPages: 1,
  lifecycleCounts: { all: 0, draft: 0, running: 0, closed: 0 },
  favoriteCount: 0,
  whose: 'team',
  teamWideTotal: null,
  owners: [],
  activeTeam: null,
  groupSubtree: false,
};

function card(id: string, title: string, groupPath: string[] = []): SurveyListPageItem {
  return {
    id,
    title,
    cardTitle: null,
    description: null,
    slug: null,
    privateToken: null,
    responseCount: 0,
    completedResponseCount: 0,
    fieldworkCompletedCount: 0,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-02T00:00:00.000Z'),
    endDate: null,
    isPublic: true,
    status: 'draft',
    lifecycle: 'draft',
    teamId: TEAM,
    teamName: '연구3본부 5팀',
    visibility: 'team',
    assignmentStatus: 'assigned',
    ownerUserId: 'u-1',
    ownerName: '홍길동',
    surveyGroupId: null,
    deletedAt: null,
    isParticipant: false,
    isFullParticipant: false,
    isLedParticipant: false,
    isFavorite: false,
    myTagIds: [],
    groupPath,
  };
}

/** 카드가 있는 한 쪽 — 숫자는 서버가 센 대로 준다. */
function page(
  items: SurveyListPageItem[],
  over: Partial<SurveyListPageResult> = {},
): SurveyListPageResult {
  return {
    ...EMPTY_PAGE,
    items,
    total: items.length,
    lifecycleCounts: { all: items.length, draft: items.length, running: 0, closed: 0 },
    ...over,
  };
}

function renderGroupScreen(
  groupId: string,
  groups: SurveyGroupListItem[] = NESTED,
  q: string | null = null,
) {
  searchParams = new URLSearchParams({ group: groupId, ...(q ? { q } : {}) });
  groupsCall.mockResolvedValue(groups);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <WorkScopeContext.Provider
        value={{
          scope: { kind: 'team', teamId: TEAM },
          teams: [{ id: TEAM, name: '연구3본부 5팀', kind: 'standard' }],
          canSeeSystemScope: false,
          isSuperadmin: false,
          currentUserId: 'u-1',
          leaderTeamIds: [],
          setScope: vi.fn(),
        }}
      >
        <SurveyListView />
      </WorkScopeContext.Provider>
    </QueryClientProvider>,
  );
  return Object.assign(view, { queryClient });
}

/** 브레드크럼의 칸들 — 글자만. */
async function breadcrumb(): Promise<(string | null)[]> {
  const nav = await screen.findByRole('navigation', { name: '그룹 위치' });
  return within(nav)
    .getAllByRole('listitem')
    .map((li) => li.textContent);
}

beforeEach(() => {
  routerReplace.mockReset();
  listPageCall.mockReset();
  listPageCall.mockResolvedValue(EMPTY_PAGE);
  groupsCall.mockReset();
  removeGroupCall.mockReset();
});

describe('그룹 화면 — 1단계 그룹', () => {
  it('브레드크럼 · 「새 하위 그룹」 · 하위 그룹 폴더 줄이 있다', async () => {
    renderGroupScreen(G_LEE);

    expect(await breadcrumb()).toEqual(['설문 목록', '이정운']);
    expect(screen.getByRole('button', { name: '새 하위 그룹' })).toBeInTheDocument();

    const folders = within(screen.getByRole('region', { name: /하위 그룹/ }));
    expect(folders.getByRole('link', { name: '2026' })).toHaveAttribute(
      'href',
      `/surveys?group=${G_2026}`,
    );
    expect(folders.getByRole('link', { name: '2025' })).toHaveAttribute(
      'href',
      `/surveys?group=${G_2025}`,
    );
    // 하위 그룹의 하위 그룹은 이 화면의 줄이 아니다 — 폴더를 눌러 들어가야 보인다.
    expect(folders.queryByRole('link', { name: '상반기' })).toBeNull();
    expect(folders.getAllByRole('listitem')[0]).toHaveTextContent('설문 18 · 하위 그룹 1');
  });

  it('제목 옆 건수와 폴더 줄 건수는 하위 그룹까지 합친 수다 — 본문 카드 수와 다를 수 있다', async () => {
    renderGroupScreen(G_LEE);

    // 제목 옆 — 이 그룹 아래 전체.
    expect(await screen.findByText('설문 34')).toBeInTheDocument();
    // 폴더 줄 — 그 하위 그룹 아래 전체, 「하위 그룹 M」은 내게 보이는 하위 그룹 수.
    const rows = within(screen.getByRole('region', { name: /하위 그룹/ })).getAllByRole('listitem');
    expect(rows.map((li) => li.textContent)).toEqual([
      expect.stringContaining('설문 18 · 하위 그룹 1'),
      expect.stringContaining('설문 12'),
    ]);
    // 본문은 직접 담긴 설문만이다(이 쪽은 0건) — 두 숫자가 다른 것은 의도다.
    expect(screen.getByText(/이 그룹에 직접 담긴 설문이 없습니다/)).toBeInTheDocument();
  });

  it('하위 그룹은 있고 직접 담긴 설문이 없으면 큰 빈 화면 대신 한 줄로 알린다', async () => {
    renderGroupScreen(G_LEE);

    expect(await screen.findByText(/이 그룹에 직접 담긴 설문이 없습니다/)).toBeInTheDocument();
    expect(screen.queryByText('이 그룹에 담긴 설문이 없습니다')).toBeNull();
  });

  it('「새 하위 그룹」을 누르면 이 그룹 안에 만드는 창이 열린다', async () => {
    const user = userEvent.setup();
    renderGroupScreen(G_LEE);

    await user.click(await screen.findByRole('button', { name: '새 하위 그룹' }));

    expect(screen.getByRole('heading', { name: '새 하위 그룹' })).toBeInTheDocument();
    expect(screen.getByText(/「이정운」 안에 만듭니다/)).toBeInTheDocument();
  });

  it('폴더 줄 ⋯ 의 「옮기기」를 누르면 그 그룹을 옮길 자리를 고르는 창이 열린다', async () => {
    const user = userEvent.setup();
    renderGroupScreen(G_LEE);

    await user.click(await screen.findByRole('button', { name: '2025 더보기' }));
    await user.click(await screen.findByRole('menuitem', { name: '옮기기' }));

    expect(screen.getByRole('heading', { name: '「2025」 옮기기' })).toBeInTheDocument();
    const places = within(screen.getByRole('radiogroup', { name: '옮길 자리' }));
    // 지금 부모는 꺼져 있고, 다른 팀의 폴더(협업 그룹)는 옮길 자리가 아니다.
    expect(places.getByRole('radio', { name: '이정운' })).toBeDisabled();
    expect(places.getByRole('radio', { name: '2026' })).toBeEnabled();
    expect(places.queryByRole('radio', { name: 'A고객사 2026' })).toBeNull();
  });
});

describe('그룹 화면 — 2·3단계 그룹', () => {
  it('2단계 — 브레드크럼이 위 그룹부터 이어지고 「새 하위 그룹」이 보인다', async () => {
    renderGroupScreen(G_2026);

    expect(await breadcrumb()).toEqual(['설문 목록', '이정운', '2026']);
    expect(
      within(screen.getByRole('navigation', { name: '그룹 위치' })).getByRole('link', {
        name: '이정운',
      }),
    ).toHaveAttribute('href', `/surveys?group=${G_LEE}`);
    expect(screen.getByRole('button', { name: '새 하위 그룹' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: /하위 그룹/ })).getByRole('link', {
        name: '상반기',
      }),
    ).toBeInTheDocument();
  });

  it('2단계 — 제목 옆 건수는 그 그룹의 것이다', async () => {
    renderGroupScreen(G_2026);

    expect(await screen.findByText('설문 18')).toBeInTheDocument();
    expect(screen.queryByText('설문 34')).toBeNull();
  });

  it('3단계 — 「새 하위 그룹」이 보이지 않는다', async () => {
    renderGroupScreen(G_H1);

    expect(await breadcrumb()).toEqual(['설문 목록', '이정운', '2026', '상반기']);
    expect(screen.queryByRole('button', { name: '새 하위 그룹' })).toBeNull();
    expect(screen.queryByRole('region', { name: /하위 그룹/ })).toBeNull();
  });
});

describe('그룹 화면 — 하위 그룹을 만들지 않은 팀', () => {
  it('폴더 줄 영역과 구역 제목이 없고 빈 그룹 안내는 전과 같다', async () => {
    renderGroupScreen(G_2025, [group(G_2025, '2025', null), group(G_2026, '2026', null)]);

    expect(await breadcrumb()).toEqual(['설문 목록', '2025']);
    expect(screen.queryByRole('region', { name: /하위 그룹/ })).toBeNull();
    expect(screen.queryByText(/직접 담긴 설문/)).toBeNull();
    expect(await screen.findByText('이 그룹에 담긴 설문이 없습니다')).toBeInTheDocument();
  });
});

describe('그룹 화면 — 협업 그룹(타 팀 폴더)', () => {
  it('브레드크럼은 「설문 목록 › 그룹 · 소유 팀」 두 칸이고 「새 하위 그룹」도 폴더 줄도 없다', async () => {
    renderGroupScreen(G_FOREIGN);

    expect(await breadcrumb()).toEqual(['설문 목록', 'A고객사 2026 · 연구1본부 1팀']);
    expect(screen.queryByRole('button', { name: '새 하위 그룹' })).toBeNull();
    expect(screen.queryByRole('region', { name: /하위 그룹/ })).toBeNull();
  });

  it('제목 옆 건수는 서버가 준 수 그대로다 — 내가 볼 수 있는, 직접 담긴 설문', async () => {
    renderGroupScreen(G_FOREIGN);

    expect(await screen.findByText('설문 2')).toBeInTheDocument();
  });
});

/**
 * 그룹 화면의 검색 (티켓 08) — 서버가 그 그룹 아래 전체에서 찾았다고 답하면(`groupSubtree`) 카드에
 * 어느 하위 그룹의 설문인지 적고, 구역 제목도 「직접 담긴 설문」이 아니라 찾은 범위를 말한다.
 */
describe('그룹 화면 — 검색은 아래 전체에서 찾는다', () => {
  it('찾은 카드에 하위 그룹 경로가 한 줄로 보이고, 직접 담긴 설문의 카드에는 없다', async () => {
    listPageCall.mockResolvedValue(
      page([card('s-direct', '직접 담긴 조사'), card('s-deep', '손자 조사', ['2026', '상반기'])], {
        groupSubtree: true,
        lifecycleCounts: { all: 34, draft: 34, running: 0, closed: 0 },
      }),
    );
    renderGroupScreen(G_LEE, NESTED, '조사');

    await screen.findByText('손자 조사');
    const lines = screen.getAllByLabelText('담긴 하위 그룹');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent('2026 › 상반기');
  });

  it('구역 제목이 찾은 범위와 결과 수를 말한다 — 「직접 담긴 설문」이라 하지 않는다', async () => {
    listPageCall.mockResolvedValue(
      page([card('s-direct', '직접 담긴 조사'), card('s-deep', '손자 조사', ['2026', '상반기'])], {
        groupSubtree: true,
        lifecycleCounts: { all: 34, draft: 34, running: 0, closed: 0 },
      }),
    );
    renderGroupScreen(G_LEE, NESTED, '조사');

    const title = await screen.findByRole('heading', { name: /이 그룹과 하위 그룹에서 찾은 설문/ });
    // 숫자는 아래 전체의 설문 수(34)가 아니라 찾은 결과 수다.
    expect(title).toHaveTextContent(/찾은 설문\s*2$/);
    expect(screen.queryByRole('heading', { name: /이 그룹에 직접 담긴 설문/ })).toBeNull();
    // 폴더 줄은 검색 중에도 그대로다 — 구조이지 검색 결과가 아니다.
    expect(
      within(screen.getByRole('region', { name: /하위 그룹/ })).getByRole('link', { name: '2026' }),
    ).toBeInTheDocument();
  });

  it('검색어가 없으면 전과 같다 — 「이 그룹에 직접 담긴 설문 N」과 경로 없는 카드', async () => {
    listPageCall.mockResolvedValue(page([card('s-direct', '직접 담긴 조사')]));
    renderGroupScreen(G_LEE);

    const title = await screen.findByRole('heading', { name: /이 그룹에 직접 담긴 설문/ });
    expect(title).toHaveTextContent(/직접 담긴 설문\s*1$/);
    expect(screen.queryByLabelText('담긴 하위 그룹')).toBeNull();
  });

  it('아래 전체에 설문이 하나도 없는 그룹을 검색하면 빈 그룹 안내가 아니라 결과 없음이다', async () => {
    listPageCall.mockResolvedValue(page([], { groupSubtree: true }));
    renderGroupScreen(G_LEE, NESTED, '없는말');

    expect(await screen.findByText(/검색어 「없는말」/)).toBeInTheDocument();
    expect(screen.queryByText(/이 그룹에 직접 담긴 설문이 없습니다/)).toBeNull();
  });

  it('하위 그룹이 있는 내 팀 그룹의 검색창은 아래 전체에서 찾는다고 알린다', async () => {
    renderGroupScreen(G_LEE);

    expect(
      await screen.findByPlaceholderText(
        '「이정운」 아래 전체에서 찾기 — 하위 그룹의 설문도 함께 나옵니다',
      ),
    ).toBeInTheDocument();
  });

  it('하위 그룹이 없는 그룹과 협업 그룹의 검색창 안내는 전과 같다', async () => {
    const { unmount } = renderGroupScreen(G_H1);
    expect(await screen.findByPlaceholderText(/^이 그룹 안에서 /)).toBeInTheDocument();
    unmount();

    renderGroupScreen(G_FOREIGN);
    expect(await screen.findByPlaceholderText(/^이 그룹 안에서 /)).toBeInTheDocument();
  });
});

describe('그룹 관리 창 — 팀의 그룹 전체를 트리로 다룬다 (티켓 07)', () => {
  it('그룹 화면에서도 버튼은 「그룹 관리」이고, 창에 하위 그룹까지 전부 선다', async () => {
    const user = userEvent.setup();
    renderGroupScreen(G_LEE);

    // 전에는 그룹 화면에서만 「그룹 편집」이라고 불렀다 — 같은 창이라 이름도 하나다.
    await user.click(await screen.findByRole('button', { name: '그룹 관리' }));
    expect(screen.queryByRole('button', { name: '그룹 편집' })).toBeNull();

    const dialog = within(await screen.findByRole('dialog', { name: '그룹 관리' }));
    expect(dialog.getByText('이정운')).toBeInTheDocument();
    expect(dialog.getByText('2026')).toBeInTheDocument();
    expect(dialog.getByText('2025')).toBeInTheDocument();
    expect(dialog.getByText('상반기')).toBeInTheDocument();
    // 타 팀 폴더는 관리 대상이 아니다.
    expect(dialog.queryByText('A고객사 2026')).toBeNull();
  });
});

describe('그룹 삭제 — 내용물이 한 단계 위로 올라간다 (티켓 06)', () => {
  it('폴더 줄 ⋯ 「삭제」가 올라갈 자리를 말하는 확인 창을 열고, 「삭제」로 그 그룹을 지운다', async () => {
    const user = userEvent.setup();
    removeGroupCall.mockResolvedValue({ success: true });
    renderGroupScreen(G_LEE);

    await user.click(await screen.findByRole('button', { name: '2026 더보기' }));
    await user.click(await screen.findByRole('menuitem', { name: '삭제' }));

    const dialog = await screen.findByRole('alertdialog', { name: '「2026」 그룹을 삭제할까요?' });
    expect(dialog).toHaveTextContent(
      '하위 그룹 1개(상반기)와 여기에 직접 담긴 설문이 한 단계 위 「이정운」 그룹으로 올라갑니다.',
    );
    // 폴더 줄에는 「설문 18」이 있어도 확인 창에는 건수가 없다.
    expect(dialog).not.toHaveTextContent('18');

    await user.click(within(dialog).getByRole('button', { name: '삭제' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(removeGroupCall).toHaveBeenCalledWith({ groupId: G_2026 });
    // 지운 것은 지금 보고 있는 그룹이 아니다 — 화면은 그대로다.
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it('보고 있던 그룹이 지워지면 그 위 그룹 화면으로 간다', async () => {
    const { queryClient } = renderGroupScreen(G_2026);
    expect(await breadcrumb()).toEqual(['설문 목록', '이정운', '2026']);

    // 2026 이 지워져 상반기가 이정운 밑으로 올라온 뒤의 목록.
    groupsCall.mockResolvedValue(
      NESTED.filter((g) => g.id !== G_2026).map((g) =>
        g.id === G_H1 ? { ...g, parentGroupId: G_LEE } : g,
      ),
    );
    await queryClient.invalidateQueries({ queryKey: surveyGroupKeys.all });

    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith(`/surveys?group=${G_LEE}`));
  });

  it('보고 있던 최상위 그룹이 지워지면 설문 목록으로 간다', async () => {
    const { queryClient } = renderGroupScreen(G_LEE);
    expect(await breadcrumb()).toEqual(['설문 목록', '이정운']);

    groupsCall.mockResolvedValue(
      NESTED.filter((g) => g.id !== G_LEE).map((g) =>
        g.parentGroupId === G_LEE ? { ...g, parentGroupId: null } : g,
      ),
    );
    await queryClient.invalidateQueries({ queryKey: surveyGroupKeys.all });

    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/surveys'));
  });

  it('처음부터 없는 그룹 주소는 전처럼 설문 목록으로 정리한다', async () => {
    renderGroupScreen('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/surveys'));
  });
});
