import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SurveyListItem } from '@/shared/contracts/survey-builder-io';

import { SurveyCard } from './survey-card';

function item(over: Partial<SurveyListItem> = {}): SurveyListItem {
  return {
    id: 's-1',
    title: '고객 만족도 조사',
    description: null,
    slug: null,
    privateToken: null,
    responseCount: 20,
    completedResponseCount: 12,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-02T00:00:00.000Z'),
    endDate: null,
    isPublic: true,
    status: 'published',
    teamId: 'team-1',
    teamName: '연구1본부 - 1팀',
    visibility: 'team',
    assignmentStatus: 'assigned',
    ownerUserId: 'u-1',
    ownerName: '홍길동',
    surveyGroupId: null,
    deletedAt: null,
    isParticipant: false,
    isFullParticipant: false,
    isLedParticipant: false,
    ...over,
  };
}

function renderCard(survey: SurveyListItem) {
  return render(
    <SurveyCard
      survey={survey}
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
