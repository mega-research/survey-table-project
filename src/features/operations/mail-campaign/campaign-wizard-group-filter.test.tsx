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
    renderWizard({ values: ['참가업체 (국내)', '참가업체 (해외)'], hasEmpty: true, truncated: false });

    await userEvent.click(screen.getByRole('button', { name: '그룹 필터' }));

    expect(screen.getByRole('checkbox', { name: '참가업체 (국내)' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '참가업체 (해외)' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '— (없음)' })).toBeInTheDocument();
  });

  it('그룹이 빈 대상이 없으면 「— (없음)」 선택지를 내지 않는다', async () => {
    renderWizard({ values: ['참가업체 (국내)'], hasEmpty: false, truncated: false });

    await userEvent.click(screen.getByRole('button', { name: '그룹 필터' }));

    expect(screen.queryByRole('checkbox', { name: '— (없음)' })).not.toBeInTheDocument();
  });

  it('그룹 값이 상한을 넘는 설문(업체명을 분류 기준으로 둔 명단)은 체크박스 대신 검색 입력이다', async () => {
    // 2,946개 가운데 가나다순 앞 200개만 체크박스로 내면 나머지 그룹은 고를 방법이 없다.
    renderWizard({ values: ['가나아이시티', '가다듬'], hasEmpty: false, truncated: true });

    await userEvent.click(screen.getByRole('button', { name: '그룹 필터' }));

    expect(screen.getByPlaceholderText('검색어 (일부만 입력해도 찾습니다)')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '가나아이시티' })).not.toBeInTheDocument();
  });

  it('고를 그룹 값이 없는 설문(분류 기준 없음)은 필터를 그리지 않는다', () => {
    renderWizard({ values: [], hasEmpty: true, truncated: false });
    expect(screen.queryByRole('button', { name: '그룹 필터' })).not.toBeInTheDocument();

    // 값을 넘기지 않는 호출(옛 호출부)도 같다.
    renderWizard();
    expect(screen.queryByRole('button', { name: '그룹 필터' })).not.toBeInTheDocument();
  });

  it('스냅샷이 받지 못할 만큼 긴 선택은 적용하지 않는다 — 미리보기와 전체 선택·발송이 갈리지 않게', async () => {
    const values = Array.from({ length: 120 }, (_, i) => `${'가나다라마바사아자차'.repeat(2)}${i}`);
    renderWizard({ values, hasEmpty: false, truncated: false });

    await userEvent.click(screen.getByRole('button', { name: '그룹 필터' }));
    for (const box of screen.getAllByRole('checkbox').filter((b) => values.includes(b.getAttribute('aria-label') ?? ''))) {
      await userEvent.click(box);
    }
    await userEvent.click(screen.getByRole('button', { name: '적용' }));

    expect(screen.getByRole('alert')).toHaveTextContent('고른 값이 너무 많습니다');
  });

  it('서버 파싱 후보(고정 열 목록)에 그룹이 표 머리와 같은 글자로 들어 있다', () => {
    expect(CAMPAIGN_HEADER_FILTER_COLUMNS).toContainEqual({
      source: FILTER_SOURCE.GROUP,
      label: '그룹',
    });
  });
});
