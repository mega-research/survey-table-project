import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
let current = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/admin/surveys/sv/operations/report',
  useSearchParams: () => current,
}));

import { ProgressGroupByTabs } from './progress-group-by-tabs';

const OWNER = { key: 'system:contact_owner', label: '컨택원', defaultOff: true };
const pushedQuery = () => String(push.mock.calls.at(-1)?.[0] ?? '').split('?')[1] ?? '';

describe('ProgressGroupByTabs — 컨택원 칩', () => {
  beforeEach(() => {
    push.mockClear();
    current = new URLSearchParams();
  });

  it('꺼진 컨택원 칩을 켜면 다른 기준 뒤에 섞인다 (주소에 남는다)', async () => {
    const user = userEvent.setup();
    render(
      <ProgressGroupByTabs
        options={[{ key: '참가 전시회', label: '참가 전시회' }, OWNER]}
        activeKeys={['참가 전시회']}
      />,
    );
    expect(screen.getByRole('button', { name: '컨택원' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: '컨택원' }));
    expect(new URLSearchParams(pushedQuery()).get('groupBy')).toBe(
      '참가 전시회,system:contact_owner',
    );
  });

  it('기본으로 켜지는 칩이 없으면 마지막 칩을 끌 때 기본 화면으로 돌아간다', async () => {
    const user = userEvent.setup();
    current = new URLSearchParams('groupBy=system:contact_owner');
    render(<ProgressGroupByTabs options={[OWNER]} activeKeys={['system:contact_owner']} />);
    await user.click(screen.getByRole('button', { name: '컨택원' }));
    expect(new URLSearchParams(pushedQuery()).has('groupBy')).toBe(false);
  });

  it('기본 칩이 있으면 마지막 칩은 꺼지지 않는다', async () => {
    const user = userEvent.setup();
    render(
      <ProgressGroupByTabs
        options={[{ key: '참가 전시회', label: '참가 전시회' }, OWNER]}
        activeKeys={['참가 전시회']}
      />,
    );
    await user.click(screen.getByRole('button', { name: '참가 전시회' }));
    expect(push).not.toHaveBeenCalled();
  });
});
