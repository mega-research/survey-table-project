import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CampaignWizard } from '@/features/operations/mail-campaign/campaign-wizard';
import type { MailTemplate } from '@/db/schema/mail';
import type { MailDisplayColumn } from '@/lib/contacts/mail-display-columns';
import type { CampaignCandidateRow } from '@/shared/contracts/mail-io';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/surveys/sv-1/operations/mail/campaigns/new',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/features/operations/queries/use-contacts', () => {
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
    piiMasks: {},
    assignmentName: null,
    respondedAt: null,
    responseStatus: null,
    progressPct: null,
    latestResultCode: null,
    latestMailStatus: null,
    linkClick: null,
    ...overrides,
  };
}

const template = { id: 'tpl-1', name: '기본 템플릿', subject: '설문 안내' } as MailTemplate;

function renderWizard(
  rows: CampaignCandidateRow[],
  mailColumns: MailDisplayColumn[],
  showResid = true,
  unresolvedClauseCount = 0,
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
        assignmentOptions={[]}
        unresolvedClauseCount={unresolvedClauseCount}
        initialClauses={[]}
        sort="resid"
        dir="asc"
        mailColumns={mailColumns}
        showResid={showResid}
      />
    </QueryClientProvider>,
  );
}

function headerLabels(): string[] {
  return screen.getAllByRole('columnheader').map((h) => h.textContent?.trim() ?? '');
}

describe('CampaignWizard 「링크 클릭」 열', () => {
  it('「수신 상황」 다음에 서고 열 머리에 필터가 붙는다', () => {
    renderWizard([candidate({ id: 'ct-1', resid: 1 })], []);

    const labels = headerLabels();
    const mail = labels.findIndex((l) => l.includes('수신 상황'));
    const click = labels.findIndex((l) => l.includes('링크 클릭'));
    expect(mail).toBeGreaterThanOrEqual(0);
    expect(click).toBe(mail + 1);
    expect(screen.getByRole('button', { name: '링크 클릭 필터' })).toBeInTheDocument();
  });

  it('눌렀으면 있음, 받고 누르지 않았으면 없음, 받은 적 없으면 —', () => {
    renderWizard(
      [
        candidate({ id: 'ct-1', resid: 1, linkClick: 'clicked' }),
        candidate({ id: 'ct-2', resid: 2, linkClick: 'not_clicked' }),
        candidate({ id: 'ct-3', resid: 3, linkClick: null }),
      ],
      [],
    );

    const idx = headerLabels().findIndex((l) => l.includes('링크 클릭'));
    const [, ...bodyRows] = screen.getAllByRole('row');
    const cells = bodyRows.map(
      (row) => within(row).getAllByRole('cell')[idx]?.textContent?.trim() ?? '',
    );
    expect(cells).toEqual(['있음', '없음', '—']);
  });
});
