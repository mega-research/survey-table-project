import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CampaignWizard } from '@/components/operations/mail-campaign/campaign-wizard';
import type { MailTemplate } from '@/db/schema/mail';
import type { CampaignCandidateRow } from '@/lib/operations/campaigns.server';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/surveys/sv-1/operations/mail/campaigns/new',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/queries', () => {
  const idle = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    useFetchCandidateIds: idle,
    usePreviewPreflight: idle,
    useCreateCampaign: idle,
  };
});

vi.mock('@/shared/lib/rpc', () => ({
  client: { contacts: { attrValues: { list: vi.fn() } } },
}));

function candidate(overrides: Partial<CampaignCandidateRow>): CampaignCandidateRow {
  return {
    id: 'ct-1',
    resid: 1,
    email: '',
    emailMasked: 'lsj...@meg...',
    groupValue: '메가리서치',
    attrs: {},
    respondedAt: null,
    responseStatus: null,
    progressPct: null,
    latestResultCode: null,
    latestMailStatus: null,
    ...overrides,
  };
}

const template = { id: 'tpl-1', name: '기본 템플릿', subject: '설문 안내' } as MailTemplate;

function renderWizard(
  rows: CampaignCandidateRow[],
  mailColumns: Array<{ key: string; label: string }>,
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CampaignWizard
        surveyId="sv-1"
        templates={[template]}
        candidates={{
          rows,
          total: rows.length,
          page: 1,
          pageSize: 20,
          exclusions: { unsubscribed: 0, negativeCode: 0, emailMissing: 0, bounced: 0 },
        }}
        currentFilter={{ clauses: [], unrespondedOnly: false }}
        initialTemplateId="tpl-1"
        columnCandidates={[]}
        resultCodeOptions={[]}
        initialClauses={[]}
        sort="resid"
        dir="asc"
        mailColumns={mailColumns}
      />
    </QueryClientProvider>,
  );
}

function headerLabels(): string[] {
  return screen.getAllByRole('columnheader').map((h) => h.textContent?.trim() ?? '');
}

/** 헤더 라벨의 열 인덱스로 본문 각 행의 셀 텍스트를 뽑는다. */
function columnCells(label: string): string[] {
  const idx = headerLabels().indexOf(label);
  expect(idx).toBeGreaterThanOrEqual(0);
  const [, ...bodyRows] = screen.getAllByRole('row');
  return bodyRows.map((row) => within(row).getAllByRole('cell')[idx]?.textContent?.trim() ?? '');
}

describe('CampaignWizard 메일 표시 컬럼', () => {
  it('시스템ID 다음 헤더로 붙고, 행마다 attrs 값을 그린다 — 값이 없으면 —', () => {
    renderWizard(
      [
        candidate({ id: 'ct-1', resid: 1, attrs: { 리스트ID: 'L-001' } }),
        candidate({ id: 'ct-2', resid: 2, attrs: {} }),
      ],
      [{ key: '리스트ID', label: '리스트 ID' }],
    );

    // [0] 체크박스, [1] 시스템ID, [2] 리스트 ID
    expect(headerLabels().indexOf('리스트 ID')).toBe(2);
    expect(columnCells('리스트 ID')).toEqual(['L-001', '—']);
  });

  it('메일 표시 컬럼이 없으면 기존 7열 그대로다', () => {
    renderWizard([candidate({ attrs: { 리스트ID: 'L-001' } })], []);

    expect(headerLabels()).toHaveLength(7);
    expect(screen.queryByText('L-001')).not.toBeInTheDocument();
  });
});
