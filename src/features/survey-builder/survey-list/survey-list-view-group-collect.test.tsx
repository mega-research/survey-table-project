/**
 * 그룹 화면에서 설문을 넣는 두 길 (3단계 중첩 티켓 04, 시안 G1·G2).
 *
 * ① 머리의 「설문 담기」 — 어느 단계의 그룹 화면에서든 미분류 설문을 여러 건 넣는다. 전에는 입구가
 *    그룹 관리 창(최상위 그룹만 다룬다) 안에만 있어 하위 그룹에는 담을 길이 없었다.
 * ② 카드 케밥의 「그룹 이동」 — 들여쓰기 트리에서 어느 단계든 고른다.
 *
 * 둘 다 끝나면 그룹 목록(건수)과 설문 목록(카드의 소속)을 함께 다시 읽는다.
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
import { WorkScopeContext } from '@/shared/lib/work-scope-context';

import { SurveyListView } from './survey-list-view';

const TEAM = '22222222-2222-4222-8222-222222222222';
const G_LEE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const G_2026 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const G_H1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const G_FOREIGN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
const SURVEY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const UNGROUPED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/surveys',
  useSearchParams: () => searchParams,
}));

const listPageCall = vi.fn();
const groupsCall = vi.fn();
const ungroupedCall = vi.fn();
const collectCall = vi.fn();
const moveCall = vi.fn();
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    workspace: {
      surveyGroups: {
        collect: (...a: unknown[]) => collectCall(...a),
        move: (...a: unknown[]) => moveCall(...a),
      },
    },
  },
  orpc: {
    surveyBuilder: { read: { listPage: { call: (...a: unknown[]) => listPageCall(...a) } } },
    workspace: {
      surveyGroups: {
        list: { call: (...a: unknown[]) => groupsCall(...a) },
        listUngrouped: { call: (...a: unknown[]) => ungroupedCall(...a) },
      },
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

const GROUPS: SurveyGroupListItem[] = [
  group(G_LEE, '이정운', null),
  group(G_2026, '2026', G_LEE),
  group(G_H1, '상반기', G_2026),
  group(G_FOREIGN, 'A고객사 2026', null, { foreignTeamName: '연구1본부 1팀' }),
];

function survey(over: Partial<SurveyListPageItem> = {}): SurveyListPageItem {
  return {
    id: SURVEY,
    title: '고객 만족도 조사',
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
    cardTitle: null,
    deletedAt: null,
    isParticipant: false,
    isFullParticipant: false,
    isLedParticipant: false,
    isFavorite: false,
    myTagIds: [],
    groupPath: [],
    ...over,
  };
}

function page(items: SurveyListPageItem[]): SurveyListPageResult {
  return {
    scope: { kind: 'team', teamId: TEAM },
    teams: [],
    canSeeSystemScope: false,
    deletedCount: null,
    items,
    total: items.length,
    page: 1,
    totalPages: 1,
    lifecycleCounts: { all: items.length, draft: items.length, running: 0, closed: 0 },
    favoriteCount: 0,
    whose: 'team',
    teamWideTotal: null,
    owners: [],
    activeTeam: null,
    groupSubtree: false,
  };
}

function renderList(groupId: string | null) {
  searchParams = new URLSearchParams(groupId ? { group: groupId } : {});
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

beforeEach(() => {
  listPageCall.mockReset();
  listPageCall.mockResolvedValue(page([]));
  groupsCall.mockReset();
  groupsCall.mockResolvedValue(GROUPS);
  ungroupedCall.mockReset();
  ungroupedCall.mockResolvedValue([
    {
      id: UNGROUPED,
      title: '미분류 브랜드 조사',
      updatedAt: new Date('2026-06-03T00:00:00.000Z'),
      canMove: true,
    },
  ]);
  collectCall.mockReset();
  collectCall.mockResolvedValue({ ok: true });
  moveCall.mockReset();
  moveCall.mockResolvedValue({ ok: true });
});

describe('그룹 화면 머리의 「설문 담기」', () => {
  it('2단계 그룹 화면에서 누르면 그 그룹에 담는 창이 열린다 — 후보는 그 팀의 미분류 설문이다', async () => {
    const user = userEvent.setup();
    renderList(G_2026);

    await user.click(await screen.findByRole('button', { name: '설문 담기' }));

    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByRole('heading', { name: '「2026」에 설문 담기' })).toBeInTheDocument();
    expect(await dialog.findByRole('checkbox', { name: '미분류 브랜드 조사' })).toBeInTheDocument();
    expect(ungroupedCall).toHaveBeenCalledWith({ teamId: TEAM, query: '' });
  });

  it.each([
    ['1단계', G_LEE],
    ['3단계', G_H1],
  ])('%s 그룹 화면에도 있다', async (_label, groupId) => {
    renderList(groupId);

    expect(await screen.findByRole('button', { name: '설문 담기' })).toBeInTheDocument();
  });

  it('협업 그룹(타 팀 폴더) 화면에는 없다 — 남의 팀 폴더에는 담지 못한다', async () => {
    renderList(G_FOREIGN);

    await screen.findByRole('navigation', { name: '그룹 위치' });
    expect(screen.queryByRole('button', { name: '설문 담기' })).toBeNull();
  });

  it('그룹 화면이 아닌 설문 목록에는 없다 — 담을 그룹이 정해지지 않았다', async () => {
    renderList(null);

    await screen.findByRole('heading', { name: '설문 목록' });
    await waitFor(() => expect(groupsCall).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: '설문 담기' })).toBeNull();
  });

  it('담으면 창이 닫히고 그룹 목록과 설문 목록을 함께 다시 읽는다', async () => {
    const user = userEvent.setup();
    renderList(G_2026);
    await user.click(await screen.findByRole('button', { name: '설문 담기' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(await dialog.findByRole('checkbox', { name: '미분류 브랜드 조사' }));
    const groupReads = groupsCall.mock.calls.length;
    const listReads = listPageCall.mock.calls.length;

    await user.click(dialog.getByRole('button', { name: '1개 담기' }));

    expect(collectCall).toHaveBeenCalledExactlyOnceWith({
      groupId: G_2026,
      surveyIds: [UNGROUPED],
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => {
      expect(groupsCall.mock.calls.length).toBeGreaterThan(groupReads);
      expect(listPageCall.mock.calls.length).toBeGreaterThan(listReads);
    });
  });
});

describe('카드 케밥의 「그룹 이동」 — 그룹 화면', () => {
  /** 카드의 케밥을 열고 「그룹 이동」 서브메뉴를 자판으로 펼친다(jsdom 은 마우스 길목을 못 지난다). */
  async function openMoveMenu(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: '더보기' }));
    (await screen.findByRole('menuitem', { name: '그룹 이동' })).focus();
    await user.keyboard('{ArrowRight}');
    return within(await screen.findByRole('group', { name: '그룹 이동' }));
  }

  it('트리에서 3단계 그룹을 고르면 그리로 옮기고 두 목록을 다시 읽는다', async () => {
    listPageCall.mockResolvedValue(page([survey({ surveyGroupId: G_LEE })]));
    const user = userEvent.setup();
    renderList(G_LEE);
    const menu = await openMoveMenu(user);
    // 협업 그룹은 옮길 자리가 아니다.
    expect(menu.queryByRole('menuitem', { name: 'A고객사 2026' })).toBeNull();
    const groupReads = groupsCall.mock.calls.length;
    const listReads = listPageCall.mock.calls.length;

    await user.click(menu.getByRole('menuitem', { name: '이정운 › 2026 › 상반기' }));

    expect(moveCall).toHaveBeenCalledExactlyOnceWith({ surveyId: SURVEY, groupId: G_H1 });
    await waitFor(() => {
      expect(groupsCall.mock.calls.length).toBeGreaterThan(groupReads);
      expect(listPageCall.mock.calls.length).toBeGreaterThan(listReads);
    });
  });

  it('하위 그룹에 담긴 설문을 「미분류로 이동」으로 뺀다', async () => {
    listPageCall.mockResolvedValue(page([survey({ surveyGroupId: G_H1 })]));
    const user = userEvent.setup();
    renderList(G_H1);
    const menu = await openMoveMenu(user);
    expect(menu.getByRole('menuitem', { current: true })).toHaveAccessibleName(
      '이정운 › 2026 › 상반기',
    );

    await user.click(screen.getByRole('menuitem', { name: /미분류로 이동/ }));

    expect(moveCall).toHaveBeenCalledExactlyOnceWith({ surveyId: SURVEY, groupId: null });
  });
});
