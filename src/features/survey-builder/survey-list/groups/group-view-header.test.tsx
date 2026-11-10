import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GroupViewHeader } from './group-view-header';

const step = (id: string, name: string) => ({ id, name });

describe('GroupViewHeader — 그룹 화면의 브레드크럼', () => {
  it('「설문 목록 › … › 지금 그룹」 — 위 단계는 그 그룹 화면으로 가는 링크이고 지금 그룹은 글자다', () => {
    render(
      <GroupViewHeader
        path={[step('g-lee', '이정운'), step('g-2026', '2026'), step('g-h1', '상반기')]}
      />,
    );

    const crumbs = within(screen.getByRole('navigation', { name: '그룹 위치' }));
    expect(crumbs.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '설문 목록',
      '이정운',
      '2026',
      '상반기',
    ]);
    expect(crumbs.getByRole('link', { name: '설문 목록' })).toHaveAttribute('href', '/surveys');
    expect(crumbs.getByRole('link', { name: '이정운' })).toHaveAttribute(
      'href',
      '/surveys?group=g-lee',
    );
    expect(crumbs.getByRole('link', { name: '2026' })).toHaveAttribute(
      'href',
      '/surveys?group=g-2026',
    );
    expect(crumbs.queryByRole('link', { name: '상반기' })).toBeNull();
    expect(crumbs.getByText('상반기')).toHaveAttribute('aria-current', 'page');

    expect(screen.getByRole('heading', { level: 1, name: '상반기' })).toBeInTheDocument();
  });

  it('최상위 그룹은 「설문 목록 › 그룹」 두 칸이다', () => {
    render(<GroupViewHeader path={[step('g-lee', '이정운')]} />);

    const crumbs = within(screen.getByRole('navigation', { name: '그룹 위치' }));
    expect(crumbs.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '설문 목록',
      '이정운',
    ]);
  });

  it('협업 그룹은 「설문 목록 › 그룹 · 소유 팀」 두 칸이고 제목 옆에 소유 팀을 적는다', () => {
    render(
      <GroupViewHeader path={[step('g-x', 'A고객사 2026')]} foreignTeamName="연구1본부 1팀" />,
    );

    const crumbs = within(screen.getByRole('navigation', { name: '그룹 위치' }));
    expect(crumbs.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '설문 목록',
      'A고객사 2026 · 연구1본부 1팀',
    ]);
    expect(screen.getByRole('heading', { level: 1, name: 'A고객사 2026' })).toBeInTheDocument();
    expect(screen.getByText('연구1본부 1팀 소유')).toBeInTheDocument();
  });
});
