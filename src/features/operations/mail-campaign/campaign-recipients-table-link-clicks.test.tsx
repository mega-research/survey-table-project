import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CampaignRecipientsTable } from '@/features/operations/mail-campaign/campaign-recipients-table';
import type { CampaignRecipientRow } from '@/shared/contracts/mail-io';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/surveys/sv-1/operations/mail/campaigns/c-1',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/shared/lib/rpc', () => ({
  client: { contacts: { attrValues: { list: vi.fn() } } },
}));

function recipient(overrides: Partial<CampaignRecipientRow>): CampaignRecipientRow {
  return {
    id: 'r-1',
    contactTargetId: 'ct-1',
    contactResid: 1,
    contactGroupValue: null,
    contactAttrs: {},
    contactPiiMasks: {},
    contactAssignmentName: null,
    latestResultCode: null,
    emailMasked: 'lsj...@meg...',
    status: 'opened',
    unsubscribedAt: null,
    resendMessageId: null,
    errorReason: null,
    sentAt: null,
    deliveredAt: null,
    openedAt: null,
    bouncedAt: null,
    complainedAt: null,
    linkClicks: [],
    ...overrides,
  };
}

function renderTable(rows: CampaignRecipientRow[]) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CampaignRecipientsTable
        surveyId="sv-1"
        campaignId="c-1"
        rows={rows}
        total={rows.length}
        page={1}
        pageSize={25}
        currentStatuses={[]}
        currentQuery=""
        headerEntries={[]}
        groupOptions={[]}
        errorOptions={[]}
        resultOptions={[]}
        mailColumns={[]}
        showResid
      />
    </QueryClientProvider>,
  );
}

/** 「링크 클릭」 열의 칸 — 본문 줄마다 하나. */
function linkClickCells(): HTMLElement[] {
  const labels = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim() ?? '');
  const idx = labels.indexOf('링크 클릭');
  expect(idx).toBeGreaterThanOrEqual(0);
  const [, ...bodyRows] = screen.getAllByRole('row');
  return bodyRows.map((row) => within(row).getAllByRole('cell')[idx] as HTMLElement);
}

describe('수신자 표의 「링크 클릭」 열', () => {
  it('열람 열 다음에 선다', () => {
    renderTable([recipient({})]);
    const labels = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim() ?? '');
    expect(labels.indexOf('링크 클릭')).toBe(labels.indexOf('열람') + 1);
  });

  it('누른 것이 없으면 —', () => {
    renderTable([recipient({})]);
    expect(linkClickCells()[0]?.textContent?.trim()).toBe('—');
  });

  it('누른 링크마다 종류를 보이고, 그 밖의 링크는 주소를 보인다', () => {
    renderTable([
      recipient({
        linkClicks: [
          { kind: 'survey', url: null, firstClickedAt: new Date('2026-11-20T05:03:10.000Z') },
          { kind: 'unsubscribe', url: null, firstClickedAt: new Date('2026-11-22T00:00:00.000Z') },
          {
            kind: 'other',
            url: 'https://spri.kr/posts?code=stat_sw_ai_reports',
            firstClickedAt: new Date('2026-11-20T05:10:00.000Z'),
          },
        ],
      }),
    ]);

    const cell = linkClickCells()[0] as HTMLElement;
    const lines = within(cell).getAllByRole('listitem');
    expect(lines).toHaveLength(3);
    expect(lines[0]?.textContent).toContain('설문 링크');
    expect(lines[1]?.textContent).toContain('수신거부');
    expect(lines[2]?.textContent).toContain('https://spri.kr/posts?code=stat_sw_ai_reports');
  });

  it('그 밖의 링크 주소는 글자로만 그린다 — 누를 수 있는 링크가 아니다', () => {
    renderTable([
      recipient({
        linkClicks: [
          { kind: 'other', url: 'https://spri.kr/posts', firstClickedAt: new Date('2026-11-20T05:10:00.000Z') },
        ],
      }),
    ]);

    const cell = linkClickCells()[0] as HTMLElement;
    expect(within(cell).queryByRole('link')).toBeNull();
  });
});
