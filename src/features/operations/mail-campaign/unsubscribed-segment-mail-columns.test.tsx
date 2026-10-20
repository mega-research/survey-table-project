import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UnsubscribedSegment } from '@/features/operations/mail-campaign/unsubscribed-segment';
import type { MailDisplayColumn } from '@/lib/contacts/mail-display-columns';
import type { UnsubscribedContactRow } from '@/shared/contracts/mail-io';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/surveys/sv-1/operations/mail/campaigns',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/shared/lib/rpc', () => ({
  client: { mail: { campaigns: { revertUnsubscribe: vi.fn() } } },
}));

function row(overrides: Partial<UnsubscribedContactRow>): UnsubscribedContactRow {
  return {
    id: 'ct-1',
    resid: 1,
    emailMasked: 'lsj...@meg...',
    groupValue: null,
    attrs: {},
    piiMasks: {},
    assignmentName: null,
    unsubscribedAt: null,
    resultUnsubscribedAt: new Date('2026-08-26T00:00:00Z'),
    ...overrides,
  };
}

function renderSegment(
  rows: UnsubscribedContactRow[],
  mailColumns: MailDisplayColumn[],
  showResid = true,
) {
  return render(
    <UnsubscribedSegment
      surveyId="sv-1"
      rows={rows}
      total={rows.length}
      page={1}
      pageSize={20}
      mailColumns={mailColumns}
      showResid={showResid}
    />,
  );
}

function headerLabels(): string[] {
  return screen.getAllByRole('columnheader').map((h) => h.textContent?.trim() ?? '');
}

function columnCells(label: string): string[] {
  const idx = headerLabels().indexOf(label);
  expect(idx).toBeGreaterThanOrEqual(0);
  const [, ...bodyRows] = screen.getAllByRole('row');
  return bodyRows.map((r) => within(r).getAllByRole('cell')[idx]?.textContent?.trim() ?? '');
}

describe('UnsubscribedSegment 메일 표시 컬럼', () => {
  it('시스템ID 다음 헤더로 붙고, 행마다 attrs 값을 그린다 — 값이 없으면 —', () => {
    renderSegment(
      [
        row({ id: 'ct-1', resid: 1, attrs: { 리스트ID: 'L-001' } }),
        row({ id: 'ct-2', resid: 2, attrs: {} }),
      ],
      [{ key: '리스트ID', label: '리스트 ID', kind: 'attrs' }],
    );

    expect(headerLabels().indexOf('리스트 ID')).toBe(1);
    expect(columnCells('리스트 ID')).toEqual(['L-001', '—']);
  });

  it('메일 표시 컬럼이 없으면 기존 6열 그대로다', () => {
    renderSegment([row({ attrs: { 리스트ID: 'L-001' } })], []);

    expect(headerLabels()).toHaveLength(6);
    expect(screen.queryByText('L-001')).not.toBeInTheDocument();
  });

  it('개인정보 열은 마스킹 힌트를 그린다 — attrs 에 같은 키가 있어도 힌트를 쓴다', () => {
    renderSegment(
      [
        row({ id: 'x-1', attrs: { 대표자명: '평문' }, piiMasks: { 대표자명: '김*수' } }),
        row({ id: 'x-2', piiMasks: {} }),
      ],
      [{ key: '대표자명', label: '대표자', kind: 'pii' }],
    );

    expect(columnCells('대표자')).toEqual(['김*수', '—']);
  });

  it('시스템ID 를 끄면 그 열이 빠진다', () => {
    renderSegment([row({})], [], false);

    expect(headerLabels()).toHaveLength(5);
    expect(headerLabels()).not.toContain('시스템ID');
  });
});
