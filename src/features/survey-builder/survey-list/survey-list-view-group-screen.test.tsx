/**
 * 설문 목록의 그룹 화면 (3단계 중첩 티켓 01, 시안 G1·G2).
 *
 * 그룹 화면은 `?group=<id>` 라는 주소다. 여기서 보는 것은 그 주소가 그리는 뼈대다 — 브레드크럼,
 * 하위 그룹 폴더 줄, 「새 하위 그룹」(1·2단계에만). 그리고 하위 그룹을 만들지 않은 팀의 그룹
 * 화면이 전과 같다는 것(폴더 줄 영역이 없다).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SurveyListPageResult } from '@/shared/contracts/survey-builder-io';
import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';
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
vi.mock('@/shared/lib/rpc', () => ({
  client: {},
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

const NESTED: SurveyGroupListItem[] = [
  group(G_LEE, '이정운', null, { surveyCount: 3 }),
  group(G_2026, '2026', G_LEE, { surveyCount: 18 }),
  group(G_2025, '2025', G_LEE, { surveyCount: 12 }),
  group(G_H1, '상반기', G_2026, { surveyCount: 7 }),
  group(G_FOREIGN, 'A고객사 2026', null, { foreignTeamName: '연구1본부 1팀' }),
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
};

function renderGroupScreen(groupId: string, groups: SurveyGroupListItem[] = NESTED) {
  searchParams = new URLSearchParams({ group: groupId });
  groupsCall.mockResolvedValue(groups);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
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
});

describe('그룹 관리 창 — 아직 최상위 그룹만 다룬다', () => {
  it('하위 그룹은 창의 목록에 서지 않는다', async () => {
    const user = userEvent.setup();
    renderGroupScreen(G_LEE);

    await user.click(await screen.findByRole('button', { name: '그룹 편집' }));

    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('이정운')).toBeInTheDocument();
    expect(dialog.queryByText('2026')).toBeNull();
    expect(dialog.queryByText('상반기')).toBeNull();
    // 타 팀 폴더는 전에도 관리 대상이 아니었다.
    expect(dialog.queryByText('A고객사 2026')).toBeNull();
  });
});
