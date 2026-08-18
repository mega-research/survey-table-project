import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const pushMock = vi.fn();
let currentParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/admin/surveys/sv-1/operations/profiles',
  useSearchParams: () => currentParams,
}));

import { ProfilesFilterBar } from '@/components/operations/profiles/profiles-filter-bar';

function pushedParams(): URLSearchParams {
  const lastCall = pushMock.mock.calls.at(-1);
  if (!lastCall) throw new Error('router.push 미호출');
  const url = String(lastCall[0]);
  return new URLSearchParams(url.split('?')[1] ?? '');
}

function renderBar(
  initialClauses: { op: 'AND' | 'OR' | null; source: string; value: string }[] = [],
) {
  return render(
    <ProfilesFilterBar
      initialClauses={initialClauses}
      initialStatus="all"
      columnCandidates={[
        { source: 'system.all', label: '전체' },
        { source: 'idx', label: '순번' },
        { source: 'browser', label: '브라우저' },
        { source: 'attrs.전시회명', label: '전시회명' },
      ]}
    />,
  );
}

describe('ProfilesFilterBar — 공용 필터바 wrapper', () => {
  beforeAll(() => {
    // Radix Select 가 jsdom 에 없는 API 를 호출한다 — 최소 폴리필.
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false) as never;
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    currentParams = new URLSearchParams();
  });

  it('기본 전체 컬럼으로 검색어만 입력해도 col=system.all 로 검색된다', async () => {
    const user = userEvent.setup();
    renderBar();

    await user.type(screen.getByLabelText('검색어'), '핵심');
    await user.click(screen.getByRole('button', { name: '검색' }));

    const p = pushedParams();
    expect(p.getAll('col')).toEqual(['system.all']);
    expect(p.getAll('q')).toEqual(['핵심']);
    // status 'all' 은 파라미터 미기록
    expect(p.get('status')).toBeNull();
  });

  it('조건 추가로 다중 절이 col[]/q[]/op[] 로 직렬화된다', async () => {
    const user = userEvent.setup();
    renderBar();

    await user.type(screen.getByLabelText('검색어'), '핵심');
    await user.click(screen.getByRole('button', { name: /필터/ }));
    await user.click(screen.getByRole('button', { name: '+ 조건 추가' }));
    // 두 번째 절: 첫 후보(system.all)로 초기화 — 값만 입력
    const group = screen.getByRole('group', { name: '조건 2' });
    const input = group.querySelector('input');
    if (!input) throw new Error('조건 2 입력 없음');
    await user.type(input, '서울');
    await user.click(screen.getByRole('button', { name: '검색' }));

    const p = pushedParams();
    expect(p.getAll('col')).toEqual(['system.all', 'system.all']);
    expect(p.getAll('q')).toEqual(['핵심', '서울']);
    expect(p.getAll('op')).toEqual(['', 'AND']);
  });

  it('상태 select 선택은 검색 시 status 파라미터로 반영된다', async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByLabelText('상태 필터'));
    await user.click(await screen.findByRole('option', { name: '이탈만' }));
    await user.type(screen.getByLabelText('검색어'), '핵심');
    await user.click(screen.getByRole('button', { name: '검색' }));

    const p = pushedParams();
    expect(p.get('status')).toBe('drop');
    expect(p.getAll('col')).toEqual(['system.all']);
  });
});
