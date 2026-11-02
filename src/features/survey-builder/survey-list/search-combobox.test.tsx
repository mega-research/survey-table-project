import { useState } from 'react';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SurveySuggestion } from '@/shared/contracts/survey-builder-io';

import { useSurveySuggestions } from '../queries/use-survey-suggestions';
import { SearchCombobox } from './search-combobox';

vi.mock('../queries/use-survey-suggestions', () => ({ useSurveySuggestions: vi.fn() }));
const useSuggestions = vi.mocked(useSurveySuggestions);

const OWNERS = [
  { id: 'u1', name: '김은철' },
  { id: 'u2', name: '방휘연' },
];

const SURVEYS: SurveySuggestion[] = [
  { id: 's1', displayTitle: 'A사 2026 고객 실태조사', ownerName: '김은철', lifecycle: 'running' },
  { id: 's2', displayTitle: 'A사 2025 고객 실태조사', ownerName: '방휘연', lifecycle: 'closed' },
];

function setup({ value = '' }: { value?: string } = {}) {
  const onCommit = vi.fn();
  const onPickOwner = vi.fn();
  const onPickSurvey = vi.fn();
  function Harness() {
    // 바깥 값(주소)은 적용할 때만 바뀐다 — 목록 화면과 같은 배선.
    const [applied, setApplied] = useState(value);
    return (
      <SearchCombobox
        value={applied}
        onCommit={(q) => {
          setApplied(q);
          onCommit(q);
        }}
        placeholder="설문 검색"
        suggestScope="team-1"
        suggestEnabled
        owners={OWNERS}
        onPickOwner={onPickOwner}
        onPickSurvey={onPickSurvey}
      />
    );
  }
  render(<Harness />);
  return {
    input: screen.getByRole('combobox', { name: '설문 검색' }),
    onCommit,
    onPickOwner,
    onPickSurvey,
    user: userEvent.setup(),
  };
}

function optionNames() {
  return screen.getAllByRole('option').map((o) => o.textContent);
}

describe('SearchCombobox — 설문·소유자 자동완성 (시안 F8-b)', () => {
  beforeEach(() => {
    useSuggestions.mockReset();
    useSuggestions.mockReturnValue({ suggestions: SURVEYS, isPending: false });
  });

  it('포커스 표시는 검색 상자 테두리 하나다 — 입력칸 자체의 전역 포커스 링은 끈다', () => {
    const { input } = setup();
    // 전역 `*:focus-visible` 링은 레이어 밖 규칙이라 important 로만 덮인다.
    expect(input.className).toContain('focus-visible:[box-shadow:none]!');
    expect(input.parentElement).toHaveClass('focus-within:border-[#2E4FCE]');
  });

  it('글자를 치면 후보 목록이 열리고 combobox 가 그 목록을 가리킨다', async () => {
    const { input, user } = setup();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await user.type(input, 'a사 실');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    const listbox = screen.getByRole('listbox', { name: '검색 후보' });
    expect(input).toHaveAttribute('aria-controls', listbox.id);
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    // 훅은 지금 검색어·범위로 불린다.
    expect(useSuggestions).toHaveBeenLastCalledWith({
      scope: 'team-1',
      q: 'a사 실',
      enabled: true,
    });
  });

  it('「설문」 칸에 후보가 소유자·목록 상태와 함께 보이고, 바닥에 모두 보기가 선다', async () => {
    const { input, user } = setup();
    await user.type(input, 'a사 실');
    const surveys = screen.getByRole('group', { name: '설문' });
    expect(
      within(surveys)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['A사 2026 고객 실태조사김은철 · 진행중', 'A사 2025 고객 실태조사방휘연 · 종료']);
    expect(screen.getByRole('option', { name: /「a사 실」 검색 결과 모두 보기/ })).toBeVisible();
  });

  it('「소유자」 칸은 이름이 맞을 때만 그린다', async () => {
    const { input, user } = setup();
    await user.type(input, 'a사 실');
    expect(screen.queryByRole('group', { name: '소유자' })).toBeNull();

    await user.clear(input);
    await user.type(input, '은철');
    const owners = screen.getByRole('group', { name: '소유자' });
    expect(
      within(owners)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([expect.stringContaining('김은철')]);
    // 칸 순서 — 소유자가 설문보다 위.
    expect(optionNames()[0]).toContain('김은철');
  });

  it('↑↓ 로 후보를 옮기면 aria-activedescendant 가 따라가고 끝에서 돈다', async () => {
    const { input, user } = setup();
    await user.type(input, 'a사 실');
    expect(input).not.toHaveAttribute('aria-activedescendant');

    await user.keyboard('{ArrowDown}');
    const first = screen.getByRole('option', { name: /A사 2026/ });
    expect(input).toHaveAttribute('aria-activedescendant', first.id);
    expect(first).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowDown}{ArrowDown}');
    const all = screen.getByRole('option', { name: /모두 보기/ });
    expect(input).toHaveAttribute('aria-activedescendant', all.id);

    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', first.id);
    await user.keyboard('{ArrowUp}');
    expect(input).toHaveAttribute('aria-activedescendant', all.id);
    // 포커스는 늘 입력칸에 있다.
    expect(input).toHaveFocus();
  });

  it('치는 동안에는 목록에 적용하지 않는다 — Enter 가 지금 검색어를 적용하고 창을 닫는다', async () => {
    const { input, user, onCommit } = setup();
    await user.type(input, 'a사 실');
    expect(onCommit).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('a사 실');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveValue('a사 실');
  });

  it('「모두 보기」를 누르면 Enter 와 같다', async () => {
    const { input, user, onCommit } = setup();
    await user.type(input, 'a사 실');
    await user.click(screen.getByRole('option', { name: /모두 보기/ }));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('a사 실');
  });

  it('설문 후보를 고르면(Enter·클릭) 그 설문을 연다', async () => {
    const { input, user, onPickSurvey, onCommit } = setup();
    await user.type(input, 'a사 실');
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onPickSurvey).toHaveBeenCalledExactlyOnceWith('s2');
    expect(onCommit).not.toHaveBeenCalled();

    await user.type(input, ' ');
    await user.click(screen.getByRole('option', { name: /A사 2026/ }));
    expect(onPickSurvey).toHaveBeenLastCalledWith('s1');
  });

  it('소유자를 고르면 그 이름에 맞던 단어를 뺀 검색어와 함께 소유자 조건을 넘긴다', async () => {
    const { input, user, onPickOwner } = setup();
    await user.type(input, '은철 2026');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onPickOwner).toHaveBeenCalledExactlyOnceWith('u1', '2026');
    expect(input).toHaveValue('2026');
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('Esc 로 닫고, 다시 치면 열린다', async () => {
    const { input, user } = setup();
    await user.type(input, 'a사');
    await user.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.type(input, ' 실');
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });

  it('자동완성이 실패해도(후보 없음) 창은 비고 Enter 검색은 동작한다', async () => {
    useSuggestions.mockReturnValue({ suggestions: null, isPending: false });
    const { input, user, onCommit } = setup();
    await user.type(input, 'a사');
    expect(screen.queryByRole('group', { name: '설문' })).toBeNull();
    await user.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('a사');
  });

  it('후보를 기다리는 동안 「설문」 칸은 찾는 중을 보이고 고를 수 있는 후보는 없다', async () => {
    useSuggestions.mockReturnValue({ suggestions: null, isPending: true });
    const { input, user } = setup();
    await user.type(input, 'a사');
    expect(screen.getByText('찾는 중…')).toBeInTheDocument();
    expect(optionNames()).toEqual([expect.stringContaining('모두 보기')]);
  });

  it('검색어를 다 지우면 곧바로 전체 목록으로 되돌린다', async () => {
    const { input, user, onCommit } = setup({ value: 'a사' });
    await user.clear(input);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('');
  });

  it('꺼져 있으면(휴지통) 후보 창을 열지 않고 Enter 검색만 한다', async () => {
    const onCommit = vi.fn();
    render(
      <SearchCombobox
        value=""
        onCommit={onCommit}
        placeholder="설문 검색"
        suggestScope={null}
        suggestEnabled={false}
        owners={OWNERS}
        onPickOwner={vi.fn()}
        onPickSurvey={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    const input = screen.getByRole('combobox', { name: '설문 검색' });
    await user.type(input, '은철{Enter}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onCommit).toHaveBeenCalledWith('은철');
    expect(useSuggestions).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  });
});

/**
 * 검색창 안 칩 (설문 즐겨찾기·태그 티켓 09, 시안 F8-c) — 걸린 태그 필터의 유일한 표현. 칩마다 ×,
 * 오른쪽 끝 「모두 지우기」는 칩과 글자만 지운다. 넘치면 「+N」으로 접는다.
 */
describe('SearchCombobox — 검색 칩', () => {
  const TAGS = [
    { id: 't1', name: 'A사', color: 'blue' as const, linkCount: 6 },
    { id: 't2', name: '2026', color: 'gray' as const, linkCount: 23 },
    { id: 't3', name: '실태조사', color: 'green' as const, linkCount: 17 },
    { id: 't4', name: '만족도', color: 'amber' as const, linkCount: 9 },
    { id: 't5', name: '해운물류', color: 'teal' as const, linkCount: 3 },
  ];

  beforeEach(() => {
    useSuggestions.mockReset();
    useSuggestions.mockReturnValue({ suggestions: null, isPending: false });
  });

  function setupChips(tags = TAGS.slice(0, 2), value = '') {
    const onRemove = vi.fn();
    const onClearAll = vi.fn();
    const onCommit = vi.fn();
    render(
      <SearchCombobox
        value={value}
        onCommit={onCommit}
        placeholder="설문 검색"
        suggestScope="team-1"
        suggestEnabled
        owners={[]}
        onPickOwner={vi.fn()}
        onPickSurvey={vi.fn()}
        chips={{ tags, onRemove, onClearAll }}
      />,
    );
    return {
      input: screen.getByRole('combobox', { name: '설문 검색' }),
      onRemove,
      onClearAll,
      onCommit,
      user: userEvent.setup(),
    };
  }

  it('칩마다 이름과 「… 필터 빼기」 단추가 있고, 누르면 그 태그만 뺀다', async () => {
    const { onRemove, user } = setupChips();
    expect(screen.getByText('A사')).toBeInTheDocument();
    expect(screen.getByText('2026')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'A사 필터 빼기' }));
    expect(onRemove).toHaveBeenCalledExactlyOnceWith('t1');
  });

  it('「모두 지우기」는 칩과 친 글자를 함께 지운다', async () => {
    const { input, onClearAll, onCommit, user } = setupChips(TAGS.slice(0, 1), '실태');
    expect(input).toHaveValue('실태');
    await user.click(screen.getByRole('button', { name: '모두 지우기' }));
    expect(onClearAll).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveValue('');
  });

  it('칩도 글자도 없으면 「모두 지우기」가 없다', () => {
    setupChips([]);
    expect(screen.queryByRole('button', { name: '모두 지우기' })).toBeNull();
  });

  it('칩이 넘치면 「+N」으로 접고, 누르면 모두 펼친다', async () => {
    const { user } = setupChips(TAGS);
    // 넓은 화면 기준 앞 3개만 — 나머지 2개는 접힌다.
    expect(screen.queryByRole('button', { name: '해운물류 필터 빼기' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '검색 칩 2개 더 보기' }));
    expect(screen.getByRole('button', { name: '해운물류 필터 빼기' })).toBeInTheDocument();
  });
});

/**
 * 자동완성 「내 태그」 칸 (설문 즐겨찾기·태그 티켓 10, 시안 F8-b) — 맨 위 칸. 내 태그 목록에서 브라우저가
 * 거르고, 고르면 검색 칩이 되며 그 태그에 맞던 단어는 지워진다.
 */
describe('SearchCombobox — 내 태그 후보', () => {
  const MY_TAGS = [
    { id: 't1', name: 'A사', color: 'blue' as const, linkCount: 6 },
    { id: 't2', name: 'A사 협력사', color: 'green' as const, linkCount: 2 },
    { id: 't3', name: '만족도', color: 'amber' as const, linkCount: 9 },
  ];

  beforeEach(() => {
    useSuggestions.mockReset();
    useSuggestions.mockReturnValue({ suggestions: SURVEYS, isPending: false });
  });

  function setupTags({
    chipTags = [] as typeof MY_TAGS,
    owners = OWNERS as { id: string; name: string }[],
  } = {}) {
    const onPickTag = vi.fn();
    const onPickOwner = vi.fn();
    const onPickSurvey = vi.fn();
    const onCommit = vi.fn();
    function Harness() {
      const [applied, setApplied] = useState('');
      return (
        <SearchCombobox
          value={applied}
          onCommit={(q) => {
            setApplied(q);
            onCommit(q);
          }}
          placeholder="설문 검색"
          suggestScope="team-1"
          suggestEnabled
          owners={owners}
          onPickOwner={onPickOwner}
          onPickSurvey={onPickSurvey}
          chips={{ tags: chipTags, onRemove: vi.fn(), onClearAll: vi.fn() }}
          tagSuggestions={{
            tags: MY_TAGS,
            onPick: (tagId, q) => {
              setApplied(q);
              onPickTag(tagId, q);
            },
          }}
        />
      );
    }
    render(<Harness />);
    return {
      input: screen.getByRole('combobox', { name: '설문 검색' }),
      onPickTag,
      onPickOwner,
      onPickSurvey,
      onCommit,
      user: userEvent.setup(),
    };
  }

  it('맞는 내 태그가 설문 수와 함께 맨 위 칸에 보인다', async () => {
    const { input, user } = setupTags();
    await user.type(input, 'a사 실');
    const tags = screen.getByRole('group', { name: '내 태그' });
    const rows = within(tags).getAllByRole('option');
    expect(rows.map((o) => o.textContent)).toEqual([
      expect.stringContaining('A사설문 6개'),
      expect.stringContaining('A사 협력사설문 2개'),
    ]);
    expect(optionNames()[0]).toContain('A사');
  });

  it('칸 순서는 내 태그 → 소유자 → 설문', async () => {
    const { input, user } = setupTags({ owners: [{ id: 'u9', name: 'A사담당' }] });
    await user.type(input, 'a사');
    const groupNames = screen
      .getAllByRole('group')
      .map((g) => document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent);
    expect(groupNames).toEqual(['내 태그', '소유자', '설문']);
  });

  it('맞는 태그가 없으면 칸을 그리지 않는다', async () => {
    const { input, user } = setupTags();
    await user.type(input, '2026');
    expect(screen.queryByRole('group', { name: '내 태그' })).toBeNull();
  });

  it('창이 열리면 첫 태그 줄이 가리켜져 있어 Enter 로 바로 고른다 — 맞던 단어는 지우고 남은 단어만', async () => {
    const { input, user, onPickTag, onCommit } = setupTags();
    await user.type(input, 'a사 실');
    const first = screen.getByRole('option', { name: /^A사설문 6개/ });
    expect(input).toHaveAttribute('aria-activedescendant', first.id);
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveTextContent('Enter 로 필터 추가');

    await user.keyboard('{Enter}');
    expect(onPickTag).toHaveBeenCalledExactlyOnceWith('t1', '실');
    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveValue('실');
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('태그 줄을 누르면 고른다 — 둘 다 맞으면 검색어가 빈다', async () => {
    const { input, user, onPickTag } = setupTags();
    await user.type(input, 'a사 협력');
    await user.click(screen.getByRole('option', { name: /A사 협력사/ }));
    expect(onPickTag).toHaveBeenCalledExactlyOnceWith('t2', '');
    expect(input).toHaveValue('');
  });

  it('↑↓ 는 칸을 넘어 이어진다 — 태그 끝에서 ↓ 면 설문 첫 줄, 처음에서 ↑ 면 모두 보기', async () => {
    const { input, user } = setupTags();
    await user.type(input, 'a사');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(input).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: /A사 2026/ }).id,
    );
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(input).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: /모두 보기/ }).id,
    );
  });

  it('태그 후보가 없으면 아무 줄도 가리키지 않고 Enter 는 지금 검색어를 적용한다', async () => {
    const { input, user, onCommit, onPickSurvey } = setupTags();
    await user.type(input, '2026');
    expect(input).not.toHaveAttribute('aria-activedescendant');
    await user.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('2026');
    expect(onPickSurvey).not.toHaveBeenCalled();
  });

  it('Esc 는 창만 닫고 태그를 고르지 않는다', async () => {
    const { input, user, onPickTag } = setupTags();
    await user.type(input, 'a사');
    await user.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(onPickTag).not.toHaveBeenCalled();
  });

  it('이미 칩으로 걸린 태그는 후보에 없다', async () => {
    const { input, user } = setupTags({ chipTags: [MY_TAGS[0]!] });
    await user.type(input, 'a사');
    const tags = screen.getByRole('group', { name: '내 태그' });
    expect(
      within(tags)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([expect.stringContaining('A사 협력사')]);
  });
});
