import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CampaignWizard } from '@/features/operations/mail-campaign/campaign-wizard';
import type { MailTemplate } from '@/db/schema/mail';
import type { MailDisplayColumn } from '@/lib/contacts/mail-display-columns';
import type { CampaignListSortKey } from '@/shared/contracts/mail-io';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/surveys/sv-1/operations/mail/campaigns/new',
  useSearchParams: () => new URLSearchParams('templateId=tpl-1'),
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

const template = { id: 'tpl-1', name: '기본 템플릿', subject: '설문 안내' } as MailTemplate;
const mailColumns: MailDisplayColumn[] = [
  { key: 'ID', label: '업체 ID', kind: 'attrs' },
  { key: '업소명', label: '업소명', kind: 'attrs' },
];

function renderWizard(sort: CampaignListSortKey, defaultSortKey: CampaignListSortKey) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CampaignWizard
        surveyId="sv-1"
        templates={[template]}
        candidates={{
          rows: [],
          total: 0,
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
        sort={sort}
        dir="asc"
        defaultSortKey={defaultSortKey}
        mailColumns={mailColumns}
        showResid
      />
    </QueryClientProvider>,
  );
}

describe('CampaignWizard 기본 정렬 열 머리글', () => {
  beforeEach(() => vi.clearAllMocks());

  it('기본 정렬 열만 정렬 버튼이 되고, 그 순서로 열렸으면 켜진 표시가 붙는다', () => {
    renderWizard('attrs.ID', 'attrs.ID');

    expect(screen.getByRole('button', { name: '업체 ID 정렬' })).toHaveTextContent('▲');
    expect(screen.queryByRole('button', { name: '업소명 정렬' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '시스템ID 정렬' })).toHaveTextContent('↕');
  });

  it('지정이 없으면 명단 열 머리글은 종전대로 글자뿐이다', () => {
    renderWizard('resid', 'resid');

    expect(screen.queryByRole('button', { name: '업체 ID 정렬' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '시스템ID 정렬' })).toHaveTextContent('▲');
  });

  it('다른 정렬로 바꾼 뒤 머리글을 누르면 기본 정렬 열로 돌아온다', async () => {
    const user = userEvent.setup();
    renderWizard('resid', 'attrs.ID');

    await user.click(screen.getByRole('button', { name: '업체 ID 정렬' }));

    expect(pushMock).toHaveBeenCalledTimes(1);
    const pushed = new URLSearchParams(String(pushMock.mock.calls[0]![0]).replace(/^\?/, ''));
    expect(pushed.get('sort')).toBe('attrs.ID');
    expect(pushed.get('dir')).toBe('asc');
  });
});
