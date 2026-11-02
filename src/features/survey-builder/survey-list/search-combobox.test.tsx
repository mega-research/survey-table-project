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
  { id: 's1', cardTitle: 'A사 2026 고객 실태조사', ownerName: '김은철', lifecycle: 'running' },
  { id: 's2', cardTitle: 'A사 2025 고객 실태조사', ownerName: '방휘연', lifecycle: 'closed' },
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
