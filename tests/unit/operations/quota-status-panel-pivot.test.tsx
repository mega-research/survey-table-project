import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { QuotaStatusPanel } from '@/components/operations/quota/quota-status-panel';
import type { QuotaStatus } from '@/lib/operations/quota-status';

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
  summary: { targetTotal: 10, currentTotal: 7, pct: 70, closedCells: 0, totalCells: 12 },
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
    // 안동시 행 × 남·20대 열 = current 7 / target 10 히트 셀
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('/ 10')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();
  });

  it('헤더는 sticky — 세로 스크롤 시 테이블 끝까지 따라온다', async () => {
    await renderOpened();
    const thead = screen.getByRole('columnheader', { name: '남' }).closest('thead');
    expect(thead?.className).toContain('sticky');
  });
});
