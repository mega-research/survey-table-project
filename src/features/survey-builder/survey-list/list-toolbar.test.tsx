import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { SurveyListLifecycleFilter } from '@/shared/contracts/survey-builder-io';

import { ListToolbar } from './list-toolbar';

// 자동완성 설문 후보는 search-combobox.test 가 본다 — 여기서는 조회 없이 빈 후보.
vi.mock('../queries/use-survey-suggestions', () => ({
  useSurveySuggestions: () => ({ suggestions: null, isPending: false }),
}));

const SUGGEST_PROPS = {
  suggestScope: null,
  owners: [],
  onPickOwner: vi.fn(),
  onPickSurvey: vi.fn(),
};

const SEARCH_CHIPS = { tags: [], onRemove: vi.fn(), onClearAll: vi.fn() };

const TAG_FILTER = {
  tags: [{ id: 't1', name: 'A사', color: 'blue' as const, linkCount: 6 }],
  selectedIds: [],
  onToggle: vi.fn(),
  onClearSelection: vi.fn(),
};

function Harness({
  onLifecycleChange,
  initial = 'all',
  favorites = null,
  tagFilter = null,
}: {
  onLifecycleChange: (next: SurveyListLifecycleFilter) => void;
  initial?: SurveyListLifecycleFilter;
  favorites?: { on: boolean; count: number; onToggle: (next: boolean) => void } | null;
  tagFilter?: typeof TAG_FILTER | null;
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
      {...SUGGEST_PROPS}
      sortBy="updatedAt"
      onSortByChange={vi.fn()}
      searchPlaceholder="설문 검색"
      advancedOpen={false}
      onToggleAdvanced={vi.fn()}
      deletedCount={null}
      showDeleted={false}
      onToggleDeleted={vi.fn()}
      favorites={favorites}
      searchChips={SEARCH_CHIPS}
      tagFilter={tagFilter}
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

/**
 * 즐겨찾기 단추 (설문 즐겨찾기·태그 티켓 06, 시안 F8-a·c) — 검색창과 상세 검색 사이. 켜면 별 켠
 * 설문만 본다. 휴지통에서는 단추 자체가 없다(목록 화면이 `favorites={null}` 로 내린다).
 */
describe('ListToolbar — 즐겨찾기 단추', () => {
  it('내 별 개수와 함께 서고, 누르면 즐겨찾기만 보기를 켠다', async () => {
    const onToggle = vi.fn();
    render(<Harness onLifecycleChange={vi.fn()} favorites={{ on: false, count: 3, onToggle }} />);

    const button = screen.getByRole('button', { name: '즐겨찾기 3' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.setup().click(button);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('켜져 있으면 눌림 상태이고 누르면 끈다', async () => {
    const onToggle = vi.fn();
    render(<Harness onLifecycleChange={vi.fn()} favorites={{ on: true, count: 3, onToggle }} />);

    const button = screen.getByRole('button', { name: '즐겨찾기 3' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await userEvent.setup().click(button);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('null 이면 단추가 없다 — 휴지통', () => {
    render(<Harness onLifecycleChange={vi.fn()} favorites={null} />);
    expect(screen.queryByRole('button', { name: /즐겨찾기/ })).toBeNull();
  });
});

/**
 * 「# 태그 ▾」 (티켓 09, 시안 F8-d) — 즐겨찾기와 상세 검색 사이. 휴지통에서는 단추가 없다(목록 화면이
 * `tagFilter={null}` 로 내린다).
 */
describe('ListToolbar — 태그 단추', () => {
  it('즐겨찾기와 상세 검색 사이에 선다', () => {
    render(
      <Harness
        onLifecycleChange={vi.fn()}
        favorites={{ on: false, count: 0, onToggle: vi.fn() }}
        tagFilter={TAG_FILTER}
      />,
    );
    const names = screen
      .getAllByRole('button')
      .map((b) => b.textContent?.trim())
      .filter((t) => t === '즐겨찾기 0' || t === '태그' || t === '상세 검색');
    expect(names).toEqual(['즐겨찾기 0', '태그', '상세 검색']);
  });

  it('null 이면 단추가 없다 — 휴지통', () => {
    render(<Harness onLifecycleChange={vi.fn()} tagFilter={null} />);
    expect(screen.queryByRole('button', { name: /^태그/ })).toBeNull();
  });
});

describe('ListToolbar — 검색창 상한', () => {
  function renderSearch() {
    const onSearch = vi.fn();
    render(
      <ListToolbar
        counts={{ all: 0, draft: 0, running: 0, closed: 0 }}
        lifecycle="all"
        onLifecycleChange={vi.fn()}
        resultCount={0}
        searchQuery=""
        onSearchQueryChange={onSearch}
        {...SUGGEST_PROPS}
        sortBy="updatedAt"
        onSortByChange={vi.fn()}
        searchPlaceholder="설문 검색"
        advancedOpen={false}
        onToggleAdvanced={vi.fn()}
        deletedCount={null}
        showDeleted={false}
        onToggleDeleted={vi.fn()}
        favorites={null}
        searchChips={SEARCH_CHIPS}
        tagFilter={null}
      />,
    );
    return { input: screen.getByRole('combobox', { name: '설문 검색' }), onSearch };
  }

  it('9번째 단어는 입력되지 않고 상한을 알린다 — 서버가 거부할 검색어를 보내지 않는다', async () => {
    const user = userEvent.setup();
    const { input, onSearch } = renderSearch();
    await user.type(input, '가 나 다 라 마 바 사 아 자');
    expect(input).toHaveValue('가 나 다 라 마 바 사 아 ');
    expect(screen.getByRole('status')).toHaveTextContent('8단어');
    // 상한 안의 검색어는 Enter 로 그대로 적용된다.
    await user.keyboard('{Enter}');
    expect(onSearch).toHaveBeenCalledExactlyOnceWith('가 나 다 라 마 바 사 아 ');

    // 상한 안으로 돌아오면 알림이 걷힌다.
    await user.type(input, '{Backspace}{Backspace}');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('상한을 넘는 붙여넣기는 통째로 막는다', async () => {
    const user = userEvent.setup();
    const { input } = renderSearch();
    await user.click(input);
    await user.paste('1 2 3 4 5 6 7 8 9 10');
    expect(input).toHaveValue('');
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
