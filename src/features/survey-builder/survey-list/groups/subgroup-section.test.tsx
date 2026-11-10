import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';

import { SubgroupSection } from './subgroup-section';

function group(id: string, name: string, surveyCount: number): SurveyGroupListItem {
  return { id, name, order: 0, parentGroupId: 'g-lee', surveyCount, foreignTeamName: null };
}

const SUBGROUPS = [
  { group: group('g-2026', '2026', 18), subgroupCount: 2 },
  { group: group('g-2025', '2025', 12), subgroupCount: 0 },
];

describe('SubgroupSection — 하위 그룹 폴더 줄', () => {
  it('하위 그룹이 없으면 아무것도 그리지 않는다 — 그룹 화면이 전과 같다', () => {
    const { container } = render(<SubgroupSection subgroups={[]} onRename={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('하위 그룹마다 그 그룹 화면으로 들어가는 폴더 줄을 그린다', () => {
    render(<SubgroupSection subgroups={SUBGROUPS} onRename={vi.fn()} />);

    const section = within(screen.getByRole('region', { name: /하위 그룹/ }));
    expect(section.getByRole('heading', { level: 2 })).toHaveTextContent('하위 그룹2');
    expect(section.getByRole('link', { name: '2026' })).toHaveAttribute(
      'href',
      '/surveys?group=g-2026',
    );
    expect(section.getByRole('link', { name: '2025' })).toHaveAttribute(
      'href',
      '/surveys?group=g-2025',
    );
  });

  it('줄마다 「설문 N」을 적고 하위 그룹이 있을 때만 「하위 그룹 M」을 잇는다', () => {
    render(<SubgroupSection subgroups={SUBGROUPS} onRename={vi.fn()} />);

    const [first, second] = screen.getAllByRole('listitem');
    expect(first).toHaveTextContent('설문 18 · 하위 그룹 2');
    expect(second).toHaveTextContent('설문 12');
    expect(second).not.toHaveTextContent('하위 그룹');
  });

  it('⋯ 메뉴에는 「이름 바꾸기」 하나가 있고 누르면 그 그룹을 넘긴다', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<SubgroupSection subgroups={SUBGROUPS} onRename={onRename} />);

    await user.click(screen.getByRole('button', { name: '2025 더보기' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['이름 바꾸기']);

    await user.click(items[0]!);
    expect(onRename).toHaveBeenCalledWith({ id: 'g-2025', name: '2025' });
  });
});
