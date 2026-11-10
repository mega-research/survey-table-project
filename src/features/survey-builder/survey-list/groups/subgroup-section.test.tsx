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
    const { container } = render(<SubgroupSection subgroups={[]} onRename={vi.fn()} onRelocate={vi.fn()} onDelete={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('하위 그룹마다 그 그룹 화면으로 들어가는 폴더 줄을 그린다', () => {
    render(<SubgroupSection subgroups={SUBGROUPS} onRename={vi.fn()} onRelocate={vi.fn()} onDelete={vi.fn()} />);

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
    render(<SubgroupSection subgroups={SUBGROUPS} onRename={vi.fn()} onRelocate={vi.fn()} onDelete={vi.fn()} />);

    const [first, second] = screen.getAllByRole('listitem');
    expect(first).toHaveTextContent('설문 18 · 하위 그룹 2');
    expect(second).toHaveTextContent('설문 12');
    expect(second).not.toHaveTextContent('하위 그룹');
  });

  it('⋯ 메뉴의 「이름 바꾸기」를 누르면 그 그룹을 넘긴다', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(<SubgroupSection subgroups={SUBGROUPS} onRename={onRename} onRelocate={vi.fn()} onDelete={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '2025 더보기' }));
    await user.click(await screen.findByRole('menuitem', { name: '이름 바꾸기' }));

    expect(onRename).toHaveBeenCalledWith({ id: 'g-2025', name: '2025' });
  });

  it('⋯ 메뉴의 「옮기기」를 누르면 그 그룹을 넘긴다', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const onRelocate = vi.fn();
    render(<SubgroupSection subgroups={SUBGROUPS} onRename={onRename} onRelocate={onRelocate} onDelete={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '2026 더보기' }));
    await user.click(await screen.findByRole('menuitem', { name: '옮기기' }));

    expect(onRelocate).toHaveBeenCalledWith({ id: 'g-2026', name: '2026' });
    expect(onRename).not.toHaveBeenCalled();
  });

  it('⋯ 메뉴의 「삭제」를 누르면 그 그룹을 넘긴다 — 올라갈 자리를 알 수 있게 상위 그룹까지', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<SubgroupSection subgroups={SUBGROUPS} onRename={vi.fn()} onRelocate={vi.fn()} onDelete={onDelete} />);

    await user.click(screen.getByRole('button', { name: '2026 더보기' }));
    await user.click(await screen.findByRole('menuitem', { name: '삭제' }));

    expect(onDelete).toHaveBeenCalledWith({ id: 'g-2026', name: '2026', parentGroupId: 'g-lee' });
  });
});
