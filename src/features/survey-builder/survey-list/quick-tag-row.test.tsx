import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PersonalTagItem } from '@/shared/contracts/workspace-io';

import { QuickTagRow } from './quick-tag-row';

// 툴바 「자주 쓰는 태그」 줄 — 누르면 걸리고 다시 누르면 풀린다.

const tags: PersonalTagItem[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    name: '후속 성과조사',
    color: 'blue',
    linkCount: 1,
  },
  { id: '00000000-0000-4000-8000-000000000002', name: '실태조사', color: 'green', linkCount: 4 },
  { id: '00000000-0000-4000-8000-000000000003', name: '안 씀', color: 'red', linkCount: 0 },
];

describe('QuickTagRow', () => {
  it('많이 쓴 순으로 그리고 안 쓴 태그는 그리지 않는다', () => {
    render(<QuickTagRow tags={tags} selectedIds={[]} onToggle={() => {}} />);
    const names = screen.getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['실태조사', '후속 성과조사']);
  });

  it('걸리지 않은 태그를 누르면 건다', () => {
    const onToggle = vi.fn();
    render(<QuickTagRow tags={tags} selectedIds={[]} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: '실태조사' }));
    expect(onToggle).toHaveBeenCalledWith(tags[1]!.id, true);
  });

  it('걸린 태그는 눌린 상태이고 누르면 푼다', () => {
    const onToggle = vi.fn();
    render(<QuickTagRow tags={tags} selectedIds={[tags[0]!.id]} onToggle={onToggle} />);
    const chip = screen.getByRole('button', { name: '후속 성과조사' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chip);
    expect(onToggle).toHaveBeenCalledWith(tags[0]!.id, false);
  });

  it('쓴 태그가 없으면 줄 자체가 없다', () => {
    const { container } = render(
      <QuickTagRow tags={[tags[2]!]} selectedIds={[]} onToggle={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
