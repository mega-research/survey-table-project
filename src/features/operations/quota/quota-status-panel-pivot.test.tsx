import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { QuotaStatusPanel } from '@/features/operations/quota/quota-status-panel';
import type { QuotaStatus } from '@/lib/quota/quota-status-calc';

const cat = (id: string, label: string) => ({ id, label });

// 등록 순서: 성별(2) → 연령대(2) → 지역(3). 최다인 지역=행, 동수인 성별=상단, 연령대=하위.
const status: QuotaStatus = {
  enabled: true,
  dimensions: [
    { id: 'dim-g', label: '성별', categories: [cat('m', '남'), cat('f', '여')] },
    { id: 'dim-a', label: '연령대', categories: [cat('a20', '20대'), cat('a30', '30대')] },
    {
      id: 'dim-r',
      label: '지역',
      categories: [cat('r1', '안동시'), cat('r2', '영주시'), cat('r3', '상주시')],
    },
  ],
  cells: [
    {
      categoryIds: ['m', 'a20', 'r1'],
      labels: ['남', '20대', '안동시'],
      target: 10,
      current: 7,
      pct: 70,
      tone: 'good',
    },
  ],
  summary: { targetTotal: 10, currentTotal: 7, pct: 70, closedCells: 0, totalCells: 12, unclassified: 0 },
};

/** 기본 접힘 상태이므로 제목을 클릭해 펼친다. */
async function renderOpened() {
  const user = userEvent.setup();
  render(<QuotaStatusPanel status={status} />);
  await user.click(screen.getByRole('button', { name: /쿼터 현황/ }));
  return user;
}

describe('QuotaStatusPanel 접기/펼치기', () => {
  it('기본은 접혀 있어 매트릭스/토글이 보이지 않는다', () => {
    render(<QuotaStatusPanel status={status} />);
    expect(screen.queryByRole('tab', { name: '매트릭스' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '남' })).not.toBeInTheDocument();
  });

  it('제목을 클릭하면 펼쳐지고 다시 클릭하면 접힌다', async () => {
    const user = await renderOpened();
    expect(screen.getByRole('tab', { name: '매트릭스' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /쿼터 현황/ }));
    expect(screen.queryByRole('tab', { name: '매트릭스' })).not.toBeInTheDocument();
  });
});

describe('QuotaStatusPanel 3조건 매트릭스', () => {
  it('3조건이면 매트릭스 토글이 활성화되고 기본 뷰가 매트릭스다', async () => {
    await renderOpened();
    expect(screen.getByRole('tab', { name: '매트릭스' })).toBeEnabled();
    expect(screen.getByRole('tab', { name: '매트릭스' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('중첩 2단 헤더를 렌더하고 셀을 조건 등록 순서 키로 매칭한다', async () => {
    await renderOpened();
    // 상단 그룹(성별)은 하위(연령대 2개)만큼 colSpan
    expect(screen.getByRole('columnheader', { name: '남' })).toHaveAttribute('colspan', '2');
    expect(screen.getAllByRole('columnheader', { name: '20대' })).toHaveLength(2);
    // 안동시 행 × 남·20대 열 = current 7 / target 10 — 칸은 n / m 만 보인다(진행바·% 없음).
    // 같은 값이 행 계·열 계·총계에도 나타나 총 4번.
    expect(screen.getAllByText('7 / 10')).toHaveLength(4);
    expect(screen.queryByText('70%')).not.toBeInTheDocument();
  });

  it('행 끝과 열 끝에 계(n / m)를 두고, 설정된 셀이 없는 줄은 — 로 둔다', async () => {
    await renderOpened();
    const rowHeaders = screen.getAllByRole('columnheader', { name: '계' });
    expect(rowHeaders.length).toBeGreaterThanOrEqual(1);
    // 영주시·상주시 행 계와 나머지 5개 열 계, 미설정 칸들은 전부 —
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(7);
  });

  it('헤더는 sticky — 세로 스크롤 시 테이블 끝까지 따라온다', async () => {
    await renderOpened();
    const thead = screen.getByRole('columnheader', { name: '남' }).closest('thead');
    expect(thead?.className).toContain('sticky');
  });
});

describe('QuotaStatusPanel 셀 없음', () => {
  it('목표가 설정된 셀이 없으면 카드를 그리되 안내를 보이고 보기 토글은 숨긴다', async () => {
    const user = userEvent.setup();
    render(
      <QuotaStatusPanel
        status={{
          ...status,
          cells: [],
          summary: { ...status.summary, targetTotal: 0, currentTotal: 0, totalCells: 0 },
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: /쿼터 현황/ }));
    expect(screen.getByText('목표가 설정된 셀이 없습니다')).toBeInTheDocument();
    expect(screen.getByText(/조건을 추가하거나 지우면 셀 목표가 초기화/)).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '매트릭스' })).not.toBeInTheDocument();
  });
});
