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

import { ContactsFilterBar } from '@/components/operations/contacts/contacts-filter-bar';

function pushedParams(): URLSearchParams {
  const lastCall = pushMock.mock.calls.at(-1);
  if (!lastCall) throw new Error('router.push 미호출');
  const url = String(lastCall[0]);
  return new URLSearchParams(url.split('?')[1] ?? '');
}

function renderBar() {
  return render(
    <ContactsFilterBar
      surveyId="sv-1"
      initialClauses={[{ op: null, source: 'attrs.전시회명', value: '핵심' }]}
      columnCandidates={[{ source: 'attrs.전시회명', label: '전시회명' }]}
      resultCodeOptions={[]}
    />,
  );
}

describe('ContactsFilterBar 전체 컬럼 기본값', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentParams = new URLSearchParams();
  });

  it('초기 상태에서 컬럼 선택 없이 검색어만 입력해도 전체 컬럼으로 검색된다', async () => {
    const user = userEvent.setup();
    render(
      <ContactsFilterBar
        surveyId="sv-1"
        initialClauses={[]}
        columnCandidates={[
          { source: 'system.all', label: '전체' },
          { source: 'attrs.전시회명', label: '전시회명' },
        ]}
        resultCodeOptions={[]}
      />,
    );

    await user.type(screen.getByLabelText('검색어'), '핵심');
    await user.click(screen.getByRole('button', { name: '검색' }));

    const p = pushedParams();
    expect(p.getAll('col')).toEqual(['system.all']);
    expect(p.getAll('q')).toEqual(['핵심']);
  });
});

describe('ContactsFilterBar 모드 상호배타', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentParams = new URLSearchParams();
  });

  it('헤더 필터 없으면 검색이 경고 없이 바로 push 된다', async () => {
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole('button', { name: '검색' }));

    const p = pushedParams();
    expect(p.getAll('col')).toEqual(['attrs.전시회명']);
    expect(p.getAll('q')).toEqual(['핵심']);
  });

  it('헤더 필터 활성 시 검색 → 경고 다이얼로그 → 확인하면 헤더 필터 제거 후 push', async () => {
    currentParams = new URLSearchParams('hcol=attrs.지역&hm=in&hv=서울');
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole('button', { name: '검색' }));
    // 경고가 먼저 뜨고 push 는 아직 없다.
    expect(pushMock).not.toHaveBeenCalled();

    await user.click(await screen.findByRole('button', { name: '검색 실행' }));

    const p = pushedParams();
    expect(p.has('hcol')).toBe(false);
    expect(p.has('hm')).toBe(false);
    expect(p.has('hv')).toBe(false);
    expect(p.getAll('col')).toEqual(['attrs.전시회명']);
  });

  it('경고에서 취소하면 push 하지 않는다', async () => {
    currentParams = new URLSearchParams('hcol=attrs.지역&hm=in&hv=서울');
    const user = userEvent.setup();
    renderBar();

    await user.click(screen.getByRole('button', { name: '검색' }));
    await user.click(await screen.findByRole('button', { name: '취소' }));

    expect(pushMock).not.toHaveBeenCalled();
  });
});
