import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CampaignRecipientsTable } from '@/components/operations/mail-campaign/campaign-recipients-table';
import type { CampaignRecipientRow } from '@/lib/operations/campaigns.server';

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
    latestResultCode: null,
    emailMasked: 'lsj...@meg...',
    status: 'sent',
    unsubscribedAt: null,
    resendMessageId: null,
    errorReason: null,
    sentAt: null,
    deliveredAt: null,
    openedAt: null,
    bouncedAt: null,
    complainedAt: null,
    ...overrides,
  };
}

function renderTable(
  rows: CampaignRecipientRow[],
  mailColumns: Array<{ key: string; label: string }>,
) {
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
        mailColumns={mailColumns}
      />
    </QueryClientProvider>,
  );
}

function headerLabels(): string[] {
  return screen.getAllByRole('columnheader').map((h) => h.textContent?.trim() ?? '');
}

function columnCells(label: string): string[] {
  const idx = headerLabels().indexOf(label);
  expect(idx).toBeGreaterThanOrEqual(0);
  const [, ...bodyRows] = screen.getAllByRole('row');
  return bodyRows.map((row) => within(row).getAllByRole('cell')[idx]?.textContent?.trim() ?? '');
}

describe('CampaignRecipientsTable 메일 표시 컬럼', () => {
  it('시스템ID 다음 헤더로 붙고, 행마다 contactAttrs 값을 그린다 — 값이 없으면 —', () => {
    renderTable(
      [
        recipient({ id: 'r-1', contactResid: 1, contactAttrs: { 리스트ID: 'L-001' } }),
        recipient({ id: 'r-2', contactTargetId: null, contactResid: null, contactAttrs: {} }),
      ],
      [{ key: '리스트ID', label: '리스트 ID' }],
    );

    // [0] 시스템ID, [1] 리스트 ID
    expect(headerLabels().indexOf('리스트 ID')).toBe(1);
    expect(columnCells('리스트 ID')).toEqual(['L-001', '—']);
  });

  it('메일 표시 컬럼이 없으면 기존 9열 그대로다', () => {
    renderTable([recipient({ contactAttrs: { 리스트ID: 'L-001' } })], []);

    expect(headerLabels()).toHaveLength(9);
    expect(screen.queryByText('L-001')).not.toBeInTheDocument();
  });
});
