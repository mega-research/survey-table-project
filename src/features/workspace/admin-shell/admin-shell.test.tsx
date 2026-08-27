/**
 * 팀 전환의 캐시 격리 (역할 모델 v2 티켓 08, 검증은 티켓 15).
 *
 * 목록 쿼리 키에 범위가 들어가는 것만으로는 격리가 끝나지 않는다 — 같은 범위로 되돌아오면
 * **그 범위의 옛 캐시**가 그대로 붙고, 그 사이 다른 범위에서 벌어진 복제·삭제가 반영되지
 * 않은 화면이 뜬다. 그래서 셸이 전환마다 전체를 stale 로 접고 RSC 까지 다시 돌린다.
 *
 * 세 동작(쿠키·캐시·RSC)이 한 자리에 있는 것이 요점이라 셋을 함께 고정한다. 하나만 빠져도
 * 증상이 "가끔 옛 팀 목록이 보인다" 라 사람 눈에는 안 잡힌다.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SYSTEM_SCOPE } from '@/shared/contracts/workspace';
import { useWorkScope } from '@/shared/lib/work-scope-context';

import { AdminShell } from './admin-shell';

const refresh = vi.fn();
const writeWorkScopeCookie = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/surveys',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/shared/lib/work-scope-cookie', () => ({
  writeWorkScopeCookie: (...args: unknown[]) => writeWorkScopeCookie(...args),
  readWorkScopeCookie: () => null,
}));

// 사이드바는 그룹 트리·프로필까지 끌고 온다 — 이 테스트의 관심은 범위 전환 하나뿐이라
// 스위처만 남기고 나머지는 걷어낸다.
vi.mock('./sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));

const TEAM_A = '11111111-1111-4111-8111-111111111111';
const TEAM_B = '22222222-2222-4222-8222-222222222222';

/** 컨텍스트 소비자 대역 — 실제 스위처와 같은 API(setScope)를 부른다. */
function ScopeProbe() {
  const { scope, setScope } = useWorkScope();
  return (
    <div>
      <span data-testid="scope">{scope.kind === 'team' ? scope.teamId : scope.kind}</span>
      <button onClick={() => setScope(TEAM_B)}>B팀으로</button>
      <button onClick={() => setScope(SYSTEM_SCOPE)}>메가리서치로</button>
    </div>
  );
}

function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <AdminShell
        user={{ id: 'u-1', name: '박팀장', isSuperadmin: true, image: null }}
        memberships={[{ teamId: TEAM_A, teamName: '연구1본부 - 1팀', role: 'leader' }]}
        teams={[
          { id: TEAM_A, name: '연구1본부 - 1팀' },
          { id: TEAM_B, name: '연구2본부 - 2팀' },
        ]}
        initialScope={{ kind: 'team', teamId: TEAM_A }}
      >
        <ScopeProbe />
      </AdminShell>
    </QueryClientProvider>,
  );
  return { invalidateQueries };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AdminShell 범위 전환', () => {
  it('팀을 바꾸면 쿠키·전체 캐시 무효화·RSC 갱신이 함께 일어난다', async () => {
    const user = userEvent.setup();
    const { invalidateQueries } = renderShell();

    expect(screen.getByTestId('scope')).toHaveTextContent(TEAM_A);

    await user.click(screen.getByRole('button', { name: 'B팀으로' }));

    expect(screen.getByTestId('scope')).toHaveTextContent(TEAM_B);
    expect(writeWorkScopeCookie).toHaveBeenCalledWith(TEAM_B);
    // 인자 없는 무효화 = 전부. 특정 키를 지목하면 feature 간 키 리터럴이 복제된다.
    expect(invalidateQueries).toHaveBeenCalledWith();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('시스템 전체 보기로의 전환도 같은 경로를 지난다', async () => {
    const user = userEvent.setup();
    const { invalidateQueries } = renderShell();

    await user.click(screen.getByRole('button', { name: '메가리서치로' }));

    expect(screen.getByTestId('scope')).toHaveTextContent('system');
    expect(writeWorkScopeCookie).toHaveBeenCalledWith(SYSTEM_SCOPE);
    expect(invalidateQueries).toHaveBeenCalledWith();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
