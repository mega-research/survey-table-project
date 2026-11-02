import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { SurveyListItem } from '@/shared/contracts/survey-builder-io';
import type { PersonalTagItem } from '@/shared/contracts/workspace-io';

import { type CardTagging, SurveyCard } from './survey-card';

function item(over: Partial<SurveyListItem> = {}): SurveyListItem {
  return {
    id: 's-1',
    title: '고객 만족도 조사',
    description: null,
    slug: null,
    privateToken: null,
    responseCount: 20,
    completedResponseCount: 12,
    fieldworkCompletedCount: 0,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-02T00:00:00.000Z'),
    endDate: null,
    isPublic: true,
    status: 'published',
    lifecycle: 'running',
    teamId: 'team-1',
    teamName: '연구1본부 - 1팀',
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
    ...over,
  };
}

function renderCard(
  survey: SurveyListItem,
  favorite: { isFavorite: boolean; onFavoriteChange: (on: boolean) => void } = {
    isFavorite: false,
    onFavoriteChange: vi.fn(),
  },
  tagging: CardTagging = { myTagIds: [], tags: [], onToggle: vi.fn(), onCreate: vi.fn() },
) {
  return render(
    <SurveyCard
      survey={survey}
      isFavorite={favorite.isFavorite}
      onFavoriteChange={favorite.onFavoriteChange}
      tagging={tagging}
      viewer={{
        scope: { kind: 'team', teamId: 'team-1' },
        currentUserId: 'u-1',
        isSuperadmin: false,
        leaderTeamIds: [],
      }}
      onDelete={vi.fn()}
      onDuplicate={vi.fn()}
      isDuplicating={false}
      groups={[]}
      onMoveToGroup={null}
    />,
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
      ),
    },
  );
}

/**
 * 카드의 종료 배지 (ADR-0030).
 *
 * 목록에는 상태 칩이 있지만 「전체」로 볼 때는 카드만 보고 끝난 조사를 알아봐야 한다.
 * 진행중·작성중에는 배지를 달지 않는다 — 대부분의 카드가 같은 배지를 달면 아무것도 말하지
 * 않게 되고, 눈에 띄어야 하는 것은 「이 설문은 더 이상 응답을 받지 않는다」 하나다.
 */
describe('SurveyCard — 종료 배지', () => {
  it('종료된 설문에는 종료 배지가 선다', () => {
    renderCard(item({ status: 'closed' }));
    expect(screen.getByText('종료')).toBeInTheDocument();
  });

  it('진행중·작성중 설문에는 종료 배지가 없다', () => {
    const { unmount } = renderCard(item({ status: 'published' }));
    expect(screen.queryByText('종료')).toBeNull();
    unmount();
    renderCard(item({ status: 'draft' }));
    expect(screen.queryByText('종료')).toBeNull();
  });
});

describe('SurveyCard — 카드 제목 (0140)', () => {
  it('카드 제목이 있으면 그것을 보이고 설문지 제목은 툴팁으로 둔다', () => {
    renderCard(item({ title: '응답자에게 보이는 긴 제목', cardTitle: '2026 1차' }));
    const heading = screen.getByText('2026 1차');
    expect(heading).toHaveAttribute('title', '설문지 제목: 응답자에게 보이는 긴 제목');
    expect(screen.queryByText('응답자에게 보이는 긴 제목')).toBeNull();
  });

  it('카드 제목이 없으면 설문지 제목을 보인다', () => {
    renderCard(item({ title: '고객 만족도 조사', cardTitle: null }));
    expect(screen.getByText('고객 만족도 조사')).toBeInTheDocument();
  });
});

/**
 * 응답수 줄 — 전체 응답 수를 보고 비어 있는 설문으로 오해하는 일이 잦아 온라인 응답 완료와
 * 실사 완료 처리 두 숫자만 보인다.
 */
describe('SurveyCard — 응답수 줄', () => {
  it('온라인 응답 완료와 실사 완료 처리 수를 보이고 전체 응답 수는 싣지 않는다', () => {
    renderCard(item({ responseCount: 20, completedResponseCount: 12, fieldworkCompletedCount: 3 }));
    expect(screen.getByText(/온라인 응답 완료 12건 · 실사 완료 처리 3건/)).toBeInTheDocument();
    expect(screen.queryByText(/전체 응답/)).toBeNull();
  });
});

/**
 * 카드의 별 (설문 즐겨찾기·태그 티켓 06) — 제목 줄 오른쪽(케밥 왼쪽)에 늘 보인다. 누르는 즉시
 * 바라는 상태를 올린다 — 낙관적 갱신·마지막 의도 전송은 목록 화면의 훅이 진다.
 */
describe('SurveyCard — 즐겨찾기 별', () => {
  it('꺼진 별은 「즐겨찾기 추가」 단추이고 누르면 켜기를 올린다', async () => {
    const onFavoriteChange = vi.fn();
    renderCard(item(), { isFavorite: false, onFavoriteChange });

    const star = screen.getByRole('button', { name: '즐겨찾기 추가' });
    expect(star).toHaveAttribute('aria-pressed', 'false');
    await userEvent.setup().click(star);
    expect(onFavoriteChange).toHaveBeenCalledWith(true);
  });

  it('켜진 별은 「즐겨찾기 해제」 단추이고 누르면 끄기를 올린다', async () => {
    const onFavoriteChange = vi.fn();
    renderCard(item(), { isFavorite: true, onFavoriteChange });

    const star = screen.getByRole('button', { name: '즐겨찾기 해제' });
    expect(star).toHaveAttribute('aria-pressed', 'true');
    await userEvent.setup().click(star);
    expect(onFavoriteChange).toHaveBeenCalledWith(false);
  });

  it('편집 권한이 없는 설문에도 별이 선다', () => {
    // 동료 소유 + 참여자 아님 — 수정 버튼은 잠기지만 별은 볼 수 있으면 켤 수 있다.
    renderCard(item({ ownerUserId: 'u-2', visibility: 'invite_only', isParticipant: true }));
    expect(screen.getByRole('button', { name: '즐겨찾기 추가' })).toBeEnabled();
  });
});

/**
 * 카드의 태그 줄 (설문 즐겨찾기·태그 티켓 07, 시안 F6 ①) — 응답 수 줄 아래, 최대 2개 + 「+N」.
 * 태그가 없으면 줄이 없고 마우스를 올리면 「+ 태그」가 보인다. 줄·「+ 태그」·케밥 「태그」가 같은
 * 태그 창을 연다.
 */
describe('SurveyCard — 내 태그 줄', () => {
  const tags: PersonalTagItem[] = [
    { id: 'a', name: 'A사', color: 'blue', linkCount: 1 },
    { id: 'b', name: '2026', color: 'red', linkCount: 1 },
    { id: 'c', name: '실태조사', color: 'green', linkCount: 1 },
  ];
  const tagging = (myTagIds: string[]): CardTagging => ({
    myTagIds,
    tags,
    onToggle: vi.fn(),
    onCreate: vi.fn(),
  });

  it('붙인 순서대로 2개와 「+N」을 보인다', () => {
    renderCard(item(), undefined, tagging(['c', 'a', 'b']));
    const row = screen.getByRole('button', { name: '태그 편집' });
    expect(row).toHaveTextContent('실태조사');
    expect(row).toHaveTextContent('A사');
    expect(row).toHaveTextContent('+1');
    expect(row).not.toHaveTextContent('2026');
  });

  it('태그가 없으면 줄이 없고 「+ 태그」 단추만 있다', () => {
    renderCard(item(), undefined, tagging([]));
    expect(screen.queryByRole('button', { name: '태그 편집' })).toBeNull();
    expect(screen.getByRole('button', { name: '태그 추가' })).toBeInTheDocument();
  });

  it('태그 줄을 누르면 태그 창이 열리고, 목록에서 누르면 그 설문에 붙이기를 올린다', async () => {
    const props = tagging(['a']);
    renderCard(item(), undefined, props);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '태그 편집' }));
    const list = await screen.findByRole('listbox', { name: '내 태그' });
    expect(list).toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: '2026' }));
    expect(props.onToggle).toHaveBeenCalledWith('b', true);
    // 창은 닫히지 않는다.
    expect(screen.getByRole('listbox', { name: '내 태그' })).toBeInTheDocument();
  });

  it('「+ 태그」와 케밥 「태그」도 같은 창을 연다', async () => {
    const user = userEvent.setup();
    const { unmount } = renderCard(item(), undefined, tagging([]));
    await user.click(screen.getByRole('button', { name: '태그 추가' }));
    expect(await screen.findByRole('listbox', { name: '내 태그' })).toBeInTheDocument();
    unmount();

    renderCard(item(), undefined, tagging(['a']));
    await user.click(screen.getByRole('button', { name: '더보기' }));
    await user.click(await screen.findByRole('menuitem', { name: '태그' }));
    expect(await screen.findByRole('listbox', { name: '내 태그' })).toBeInTheDocument();
  });
});
