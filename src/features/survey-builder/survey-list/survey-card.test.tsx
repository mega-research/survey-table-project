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
    fieldworkCompletedCount: 0,
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
    cardTitle: null,
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
