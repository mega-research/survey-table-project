import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pushMock = vi.fn();
let currentParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/admin/surveys/sv-1/operations/contacts',
  useSearchParams: () => currentParams,
}));

import { FilterResetButton } from '@/components/operations/filters/filter-reset-button';
import { ContactsFilterBar } from '@/components/operations/contacts/contacts-filter-bar';

function pushedParams(): URLSearchParams {
  const lastCall = pushMock.mock.calls.at(-1);
  if (!lastCall) throw new Error('router.push 미호출');
  const url = String(lastCall[0]);
  return new URLSearchParams(url.split('?')[1] ?? '');
}

describe('FilterResetButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentParams = new URLSearchParams();
  });

  it('감시 파라미터가 하나도 없으면 비활성이다', () => {
    render(<FilterResetButton clearParams={['col', 'q', 'page']} activeParams={['col', 'q']} />);
    expect(screen.getByRole('button', { name: '초기화' })).toBeDisabled();
  });

  it('page 만 있는 상태는 필터가 아니므로 비활성이다', () => {
    currentParams = new URLSearchParams('page=3');
    render(<FilterResetButton clearParams={['col', 'q', 'page']} activeParams={['col', 'q']} />);
    expect(screen.getByRole('button', { name: '초기화' })).toBeDisabled();
  });

  it('클릭 시 clearParams 만 제거하고 나머지 파라미터는 보존한다', async () => {
    const user = userEvent.setup();
    currentParams = new URLSearchParams('col=attrs.a&q=v&page=2&sort=resid&hcol=attrs.b&hm=in&hv=x');
    render(
      <FilterResetButton
        clearParams={['col', 'q', 'op', 'hcol', 'hm', 'hv', 'page']}
        activeParams={['col', 'q', 'op', 'hcol', 'hm', 'hv']}
      />,
    );
    await user.click(screen.getByRole('button', { name: '초기화' }));
    const next = pushedParams();
    expect(next.has('col')).toBe(false);
    expect(next.has('q')).toBe(false);
    expect(next.has('hcol')).toBe(false);
    expect(next.has('page')).toBe(false);
    expect(next.get('sort')).toBe('resid');
  });

  it('클릭 시 onReset 콜백으로 로컬 state 정리 기회를 준다', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    currentParams = new URLSearchParams('q=v&col=attrs.a');
    render(
      <FilterResetButton clearParams={['col', 'q']} onReset={onReset} />,
    );
    await user.click(screen.getByRole('button', { name: '초기화' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

describe('ContactsFilterBar resetExtraParams — 메일 마법사 unresponded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentParams = new URLSearchParams();
  });

  function renderWizardBar() {
    return render(
      <ContactsFilterBar
        surveyId="sv-1"
        initialClauses={[]}
        columnCandidates={[{ source: 'attrs.전시회명', label: '전시회명' }]}
        resultCodeOptions={[]}
        ariaLabel="수신자 필터"
        resetExtraParams={['unresponded']}
      />,
    );
  }

  it('unresponded 만 걸려 있어도 초기화가 활성이고, 클릭 시 함께 지운다', async () => {
    const user = userEvent.setup();
    currentParams = new URLSearchParams('unresponded=1');
    renderWizardBar();
    const button = screen.getByRole('button', { name: '초기화' });
    expect(button).not.toBeDisabled();
    await user.click(button);
    const next = pushedParams();
    expect(next.has('unresponded')).toBe(false);
  });

  it('빌더 조건과 함께 걸린 unresponded 도 초기화 한 번에 지운다', async () => {
    const user = userEvent.setup();
    currentParams = new URLSearchParams('col=attrs.a&q=v&unresponded=1&templateId=t1');
    renderWizardBar();
    await user.click(screen.getByRole('button', { name: '초기화' }));
    const next = pushedParams();
    expect(next.has('col')).toBe(false);
    expect(next.has('unresponded')).toBe(false);
    // 필터가 아닌 파라미터(템플릿 선택)는 보존.
    expect(next.get('templateId')).toBe('t1');
  });
});
