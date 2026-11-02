import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ListToolbar } from './list-toolbar';
import type { SurveyListLifecycleFilter } from './survey-list-pipeline';

function Harness({
  onLifecycleChange,
  initial = 'all',
}: {
  onLifecycleChange: (next: SurveyListLifecycleFilter) => void;
  initial?: SurveyListLifecycleFilter;
}) {
  const [lifecycle, setLifecycle] = useState<SurveyListLifecycleFilter>(initial);
  return (
    <ListToolbar
      counts={{ all: 104, draft: 9, running: 23, closed: 72 }}
      lifecycle={lifecycle}
      onLifecycleChange={(next) => {
        setLifecycle(next);
        onLifecycleChange(next);
      }}
      resultCount={23}
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
    />
  );
}

function renderToolbar(initial: SurveyListLifecycleFilter = 'all') {
  const onChange = vi.fn();
  render(<Harness onLifecycleChange={onChange} initial={initial} />);
  return onChange;
}

/**
 * 목록 상태 세그먼트 (시안 F8-a 둘째 줄 왼쪽) — 하나만 고르는 회색 트랙, 숫자 포함.
 *
 * `closed` 의 라벨은 **「종료」**다(ADR-0030). 「완료」는 응답 상태의 어휘(완료 응답 N건)와
 * 겹친다 — 같은 화면의 카드에 「완료 12건」이 함께 서므로 무엇의 완료인지 읽히지 않는다.
 */
describe('ListToolbar — 목록 상태 세그먼트', () => {
  it('라디오 그룹으로 넷이 서고 숫자를 함께 읽힌다', () => {
    renderToolbar();
    const group = screen.getByRole('radiogroup', { name: '목록 상태' });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual([
      '전체 104',
      '작성중 9',
      '진행중 23',
      '종료 72',
    ]);
    expect(screen.getByRole('radio', { name: '전체 104' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('radio', { name: /완료/ })).toBeNull();
  });

  it('종료를 누르면 종료로 좁힌다', async () => {
    const user = userEvent.setup();
    const onChange = renderToolbar();
    await user.click(screen.getByRole('radio', { name: '종료 72' }));
    expect(onChange).toHaveBeenCalledWith('closed');
    expect(screen.getByRole('radio', { name: '종료 72' })).toHaveAttribute('aria-checked', 'true');
  });

  it('고른 칸만 탭 순서에 들어간다 — 그룹 안은 화살표로 옮긴다', () => {
    renderToolbar('running');
    const tabbable = screen.getAllByRole('radio').filter((r) => r.tabIndex === 0);
    expect(tabbable.map((r) => r.textContent)).toEqual(['진행중 23']);
  });

  it('화살표 키로 고르고 포커스가 따라간다 — 끝에서 처음으로 돈다', async () => {
    const user = userEvent.setup();
    const onChange = renderToolbar('draft');
    screen.getByRole('radio', { name: '작성중 9' }).focus();

    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('running');
    expect(screen.getByRole('radio', { name: '진행중 23' })).toHaveFocus();

    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith('all');
    expect(screen.getByRole('radio', { name: '전체 104' })).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('closed');

    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('all');
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('closed');
  });
});

describe('ListToolbar — 둘째 줄 오른쪽', () => {
  it('결과 수를 「N개」로 정렬 옆에 보인다', () => {
    renderToolbar();
    expect(screen.getByText('23개')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '정렬' })).toBeInTheDocument();
  });
});
