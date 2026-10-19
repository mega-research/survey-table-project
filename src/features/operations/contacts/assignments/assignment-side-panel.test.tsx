import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const facets = vi.fn();
const matches = vi.fn();
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    contacts: {
      assignments: {
        facets: (...a: unknown[]) => facets(...a),
        matches: (...a: unknown[]) => matches(...a),
      },
    },
  },
}));

import { decodeMultiClauseValue, encodeMultiClauseValue } from '@/lib/operations/filter-shared';

import { AssignmentSidePanel } from './assignment-side-panel';

const SURVEY = '00000000-0000-4000-8000-000000000001';
const ME = { id: 'a-10', name: '10차' };

function Harness({ source, initial }: { source: string; initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <output data-testid="value">{JSON.stringify(decodeMultiClauseValue(value) ?? value)}</output>
      <AssignmentSidePanel
        surveyId={SURVEY}
        assignment={ME}
        focused={{ source, value }}
        onFocusedValueChange={setValue}
        clauses={[{ source, value: value || '1', op: '' }]}
        columnCandidates={[
          { source: 'attrs.참가 전시회', label: '참가 전시회' },
          { source: 'pii.대표자', label: '대표자' },
          { source: 'system.resid', label: '시스템ID' },
        ]}
        displayColumn={{ source: 'attrs.기업명', label: '기업명' }}
        otherOwnerNames={['11차']}
      />
    </>
  );
}

function renderPanel(source: string, initial = '') {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness source={source} initial={initial} />
    </QueryClientProvider>,
  );
}

describe('AssignmentSidePanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('값 종류가 적은 열은 값 목록 — 체크가 조건 줄 값과 양방향으로 맞는다', async () => {
    const user = userEvent.setup();
    facets.mockResolvedValue({
      kind: 'values',
      values: [
        { value: 'CES 2026', label: 'CES 2026', count: 142 },
        { value: 'MWC 2026', label: 'MWC 2026', count: 61 },
        { value: '__none__', label: '— (없음)', count: 12 },
      ],
      total: 215,
    });
    renderPanel('attrs.참가 전시회', encodeMultiClauseValue(['MWC 2026']));
    const mwc = await screen.findByRole('checkbox', { name: /MWC 2026/ });
    expect(mwc).toBeChecked();
    expect(screen.getByText('1개 선택 · 명단 61명')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /CES 2026/ }));
    expect(screen.getByTestId('value')).toHaveTextContent('["CES 2026","MWC 2026"]');
    await user.click(screen.getByRole('checkbox', { name: /MWC 2026/ }));
    expect(screen.getByTestId('value')).toHaveTextContent('["CES 2026"]');
    expect(matches).not.toHaveBeenCalled();
  });

  it('시스템ID·개인정보 열은 대상 목록 — 다른 컨택원 대상을 강조하고 개인정보는 마스킹만', async () => {
    matches.mockResolvedValue({
      rows: [
        {
          id: 't1',
          resid: 2,
          attrs: { 기업명: '(주)한빛테크' },
          piiMaskHints: { 대표자: { fieldType: 'name', maskHint: '김**' } },
          assignment: { id: 'a-11', name: '11차' },
        },
        { id: 't2', resid: 4, attrs: { 기업명: '대성정밀' }, piiMaskHints: {}, assignment: null },
      ],
      total: 2,
      page: 1,
      pageSize: 10,
    });
    renderPanel('pii.대표자', '김도윤');
    expect(await screen.findByText('조건에 맞는 대상 2명')).toBeInTheDocument();
    const other = screen.getByText('11차');
    expect(other.className).toContain('orange');
    expect(screen.getByText('김**')).toBeInTheDocument();
    expect(screen.queryByText('김도윤', { selector: 'td' })).toBeNull();
    expect(screen.getByText(/다른 컨택원\(11차\)에 있던 대상은 교체하면 10차/)).toBeInTheDocument();
    expect(facets).not.toHaveBeenCalled();
    const header = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(header).toEqual(['시스템ID', '기업명', '대표자', '현재 컨택원']);
  });

  it('값이 많은 attrs 열은 대상 목록으로 바뀐다', async () => {
    facets.mockResolvedValue({ kind: 'many' });
    matches.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 10 });
    renderPanel('attrs.참가 전시회', 'CES');
    expect(await screen.findByText('조건에 맞는 대상 0명')).toBeInTheDocument();
  });
});
