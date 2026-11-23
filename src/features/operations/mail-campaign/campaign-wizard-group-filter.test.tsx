import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CampaignWizard } from '@/features/operations/mail-campaign/campaign-wizard';
import type { MailTemplate } from '@/db/schema/mail';
import { CAMPAIGN_HEADER_FILTER_COLUMNS, FILTER_SOURCE } from '@/lib/operations/filter-shared';
import type { CampaignCandidateRow, CampaignGroupFacet } from '@/shared/contracts/mail-io';

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

const row: CampaignCandidateRow = {
  id: 'ct-1',
  resid: 1,
  email: '',
  emailMasked: 'lsj...@meg...',
  groupValue: '참가업체 (국내)',
  attrs: {},
  piiMasks: {},
  assignmentName: null,
  respondedAt: null,
  responseStatus: null,
  progressPct: null,
  latestResultCode: null,
  latestMailStatus: null,
  linkClick: null,
};

const template = { id: 'tpl-1', name: '기본 템플릿', subject: '설문 안내' } as MailTemplate;

function renderWizard(groupFacet?: CampaignGroupFacet) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CampaignWizard
        surveyId="sv-1"
        templates={[template]}
        candidates={{
          rows: [row],
          total: 1,
          page: 1,
          pageSize: 20,
          exclusions: { unsubscribed: 0, negativeCode: 0, emailMissing: 0, bounced: 0 },
        }}
        currentFilter={{ clauses: [], unrespondedOnly: false }}
        initialTemplateId="tpl-1"
        columnCandidates={[]}
        resultCodeOptions={[]}
        assignmentOptions={[]}
        unresolvedClauseCount={0}
        initialClauses={[]}
        sort="resid"
        dir="asc"
        mailColumns={[]}
        showResid
        {...(groupFacet ? { groupFacet } : {})}
      />
    </QueryClientProvider>,
  );
}

describe('CampaignWizard 「그룹」 열 머리 필터', () => {
  it('그룹 값이 있으면 열 머리에 필터가 붙고, 선택지는 그 값들과 「— (없음)」이다', async () => {
    renderWizard({ values: ['참가업체 (국내)', '참가업체 (해외)'], hasEmpty: true });

    await userEvent.click(screen.getByRole('button', { name: '그룹 필터' }));

    expect(screen.getByRole('checkbox', { name: '참가업체 (국내)' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '참가업체 (해외)' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '— (없음)' })).toBeInTheDocument();
  });

  it('그룹이 빈 대상이 없으면 「— (없음)」 선택지를 내지 않는다', async () => {
    renderWizard({ values: ['참가업체 (국내)'], hasEmpty: false });

    await userEvent.click(screen.getByRole('button', { name: '그룹 필터' }));

    expect(screen.queryByRole('checkbox', { name: '— (없음)' })).not.toBeInTheDocument();
  });

  it('고를 그룹 값이 없는 설문(분류 기준 없음)은 필터를 그리지 않는다', () => {
    renderWizard({ values: [], hasEmpty: true });
    expect(screen.queryByRole('button', { name: '그룹 필터' })).not.toBeInTheDocument();

    // 값을 넘기지 않는 호출(옛 호출부)도 같다.
    renderWizard();
    expect(screen.queryByRole('button', { name: '그룹 필터' })).not.toBeInTheDocument();
  });

  it('서버 파싱 후보(고정 열 목록)에 그룹이 표 머리와 같은 글자로 들어 있다', () => {
    expect(CAMPAIGN_HEADER_FILTER_COLUMNS).toContainEqual({
      source: FILTER_SOURCE.GROUP,
      label: '그룹',
    });
  });
});
