import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UnsubscribedSegment } from '@/components/operations/mail-campaign/unsubscribed-segment';
import type { UnsubscribedContactRow } from '@/lib/operations/campaigns.server';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/admin/surveys/sv-1/operations/mail/campaigns',
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
    unsubscribedAt: null,
    resultUnsubscribedAt: new Date('2026-08-26T00:00:00Z'),
    ...overrides,
  };
}

function renderSegment(
  rows: UnsubscribedContactRow[],
  mailColumns: Array<{ key: string; label: string }>,
) {
  return render(
    <UnsubscribedSegment
      surveyId="sv-1"
      rows={rows}
      total={rows.length}
      page={1}
      pageSize={20}
      mailColumns={mailColumns}
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
      [{ key: '리스트ID', label: '리스트 ID' }],
    );

    expect(headerLabels().indexOf('리스트 ID')).toBe(1);
    expect(columnCells('리스트 ID')).toEqual(['L-001', '—']);
  });

  it('메일 표시 컬럼이 없으면 기존 6열 그대로다', () => {
    renderSegment([row({ attrs: { 리스트ID: 'L-001' } })], []);

    expect(headerLabels()).toHaveLength(6);
    expect(screen.queryByText('L-001')).not.toBeInTheDocument();
  });
});
