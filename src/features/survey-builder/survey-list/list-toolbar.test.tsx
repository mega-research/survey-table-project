import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ListToolbar } from './list-toolbar';

function renderToolbar(onStatusChipChange = vi.fn()) {
  render(
    <ListToolbar
      counts={{ all: 5, draft: 1, published: 2, closed: 2 }}
      statusChip="all"
      onStatusChipChange={onStatusChipChange}
      searchQuery=""
      onSearchQueryChange={vi.fn()}
      sortBy="updatedAt"
      onSortByChange={vi.fn()}
      searchPlaceholder="설문 검색"
      advancedOpen={false}
      onToggleAdvanced={vi.fn()}
      deletedCount={null}
      showDeleted={false}
      onToggleDeleted={vi.fn()}
    />,
  );
  return onStatusChipChange;
}

/**
 * 상태 칩의 화면 어휘 (ADR-0030).
 *
 * `closed` 의 라벨은 **「종료」**다. 와이어프레임(.pen FLOW 6)은 「완료」로 그렸지만, 버튼이
 * 「설문 종료」이고 「완료」는 응답 상태의 어휘(완료 응답 N건)와 겹친다 — 같은 화면의 카드에
 * 「완료 12건」이 함께 서므로 칩까지 「완료」면 무엇의 완료인지 읽히지 않는다.
 */
describe('ListToolbar — 상태 칩', () => {
  it('종료된 설문 칩은 「종료」로 읽히고 건수를 함께 보인다', () => {
    renderToolbar();
    expect(screen.getByRole('button', { name: '종료 2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /완료/ })).toBeNull();
  });

  it('종료 칩을 누르면 closed 로 좁힌다', async () => {
    const user = userEvent.setup();
    const onChange = renderToolbar();
    await user.click(screen.getByRole('button', { name: '종료 2' }));
    expect(onChange).toHaveBeenCalledWith('closed');
  });
});
