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
      [{ key: '리스트ID', label: '리스트 ID', kind: 'attrs' }],
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

  it('개인정보 열은 마스킹 힌트를 그린다 — attrs 에 같은 키가 있어도 힌트를 쓴다', () => {
    renderWizard(
      [
        candidate({ id: 'x-1', attrs: { 대표자명: '평문' }, piiMasks: { 대표자명: '김*수' } }),
        candidate({ id: 'x-2', piiMasks: {} }),
      ],
      [{ key: '대표자명', label: '대표자', kind: 'pii' }],
    );

    expect(columnCells('대표자')).toEqual(['김*수', '—']);
  });

  it('컨택원 열은 지금 맡은 컨택원 이름을 그린다 — 배정 없음이면 —', () => {
    renderWizard(
      [
        candidate({ id: 'o-1', assignmentName: '이메일 갱신' }),
        candidate({ id: 'o-2', assignmentName: null }),
      ],
      [{ key: 'contact_owner', label: '컨택원', kind: 'owner' }],
    );

    expect(columnCells('컨택원')).toEqual(['이메일 갱신', '—']);
  });

  it('시스템ID 를 끄면 그 열이 빠진다', () => {
    renderWizard([candidate({})], [], false);

    expect(headerLabels()).toHaveLength(6);
    expect(headerLabels()).not.toContain('시스템ID');
  });
});

describe('CampaignWizard 적용할 수 없는 조건', () => {
  it('빠진 조건이 있으면 명단이 넓다고 경고한다', () => {
    renderWizard([candidate({})], [], true, 1);

    expect(screen.getByRole('alert')).toHaveTextContent('적용할 수 없는 조건 1개');
  });

  it('빠진 조건이 없으면 경고가 없다', () => {
    renderWizard([candidate({})], []);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
