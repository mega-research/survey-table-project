import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ClientResponsesPage } from '@/shared/contracts/workspace-io';

import { ClientResponsesTable } from './client-responses-table';

const BASE = '/client/tok/responses';

function pageOf(over: Partial<ClientResponsesPage> = {}): ClientResponsesPage {
  return {
    columns: ['순번', '상태', '시작일시'],
    rows: [
      {
        idx: 2,
        cells: [
          { kind: 'text', text: '2' },
          { kind: 'status', label: '이탈', tone: 'gray', sub: '4/33(61) · Q1' },
          { kind: 'text', text: '2026. 10. 26. 21:27' },
        ],
      },
      {
        idx: 1,
        cells: [
          { kind: 'text', text: '1' },
          { kind: 'status', label: '완료', tone: 'green' },
          { kind: 'text', text: null },
        ],
      },
    ],
    total: 45,
    page: 2,
    pageSize: 20,
    status: 'all',
    ...over,
  };
}

/**
 * 클라이언트 링크의 응답 내역 표 (`.scratch/client-link-response-list` 티켓 03).
 *
 * 정적인 읽기 표다 — 행을 눌러도 아무 데도 가지 않고, 링크는 상태 좁히기와 페이지 이동뿐이다.
 */
describe('ClientResponsesTable', () => {
  it('상태 칸은 알약이고 이탈 위치가 함께 보인다', () => {
    render(<ClientResponsesTable page={pageOf()} basePath={BASE} />);
    const table = within(screen.getByRole('table'));
    expect(table.getByText('이탈')).toBeInTheDocument();
    expect(table.getByText(/4\/33\(61\) · Q1/)).toBeInTheDocument();
    expect(table.getByText('완료')).toBeInTheDocument();
  });

  it('행 안에는 링크가 없다 — 상세·수정 화면이 없다', () => {
    render(<ClientResponsesTable page={pageOf()} basePath={BASE} />);
    for (const row of screen.getAllByRole('row').slice(1)) {
      expect(within(row).queryByRole('link')).toBeNull();
    }
  });

  it('상태 좁히기는 첫 페이지로 가고, 고른 상태가 표시된다', () => {
    render(<ClientResponsesTable page={pageOf({ status: 'drop' })} basePath={BASE} />);
    expect(screen.getByRole('link', { name: '완료' })).toHaveAttribute(
      'href',
      `${BASE}?status=completed`,
    );
    expect(screen.getByRole('link', { name: '전체' })).toHaveAttribute('href', BASE);
    expect(screen.getByRole('link', { name: '이탈' })).toHaveAttribute('aria-current', 'page');
  });

  it('페이지 이동은 지금 상태를 이어 간다', () => {
    render(<ClientResponsesTable page={pageOf({ status: 'drop' })} basePath={BASE} />);
    expect(screen.getByRole('link', { name: '이전' })).toHaveAttribute(
      'href',
      `${BASE}?status=drop&page=1`,
    );
    expect(screen.getByRole('link', { name: '다음' })).toHaveAttribute(
      'href',
      `${BASE}?status=drop&page=3`,
    );
  });

  it('응답이 없으면 빈 안내다', () => {
    render(<ClientResponsesTable page={pageOf({ rows: [], total: 0 })} basePath={BASE} />);
    expect(screen.getByText('응답이 없습니다.')).toBeInTheDocument();
  });
});
