import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const pushMock = vi.fn();
let currentParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/admin/surveys/sv-1/operations/contacts',
  useSearchParams: () => currentParams,
}));

import { ContactsFilterBar } from '@/features/operations/contacts/contacts-filter-bar';

function pushedParams(): URLSearchParams {
  const lastCall = pushMock.mock.calls.at(-1);
  if (!lastCall) throw new Error('router.push 미호출');
  const url = String(lastCall[0]);
  return new URLSearchParams(url.split('?')[1] ?? '');
}

const CANDIDATES = [
  { source: 'attrs.전시회명', label: '전시회명' },
  { source: 'system.link_click', label: '링크 클릭' },
];

describe('ContactsFilterBar 「링크 클릭」 검색 조건', () => {
  beforeAll(() => {
    // Radix Select 가 jsdom 에 없는 API 를 호출한다 — 열기/포커스 이동용 최소 폴리필.
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => false) as never;
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    currentParams = new URLSearchParams();
  });

  it('열을 고른 직후 검색하면 「없음」으로 검색된다 — 빈 값으로 조용히 버려지지 않는다', async () => {
    // 이 열의 쓰임은 독촉 대상 고르기다 — 기본값이 누르지 않은 대상이다.
    const user = userEvent.setup();
    render(
      <ContactsFilterBar
        surveyId="sv-1"
        initialClauses={[]}
        columnCandidates={CANDIDATES}
        resultCodeOptions={[]}
      />,
    );

    await user.click(screen.getByLabelText('검색 컬럼'));
    await user.click(await screen.findByRole('option', { name: '링크 클릭' }));
    await user.click(screen.getByRole('button', { name: '검색' }));

    const p = pushedParams();
    expect(p.getAll('col')).toEqual(['system.link_click']);
    expect(p.getAll('q')).toEqual(['not_clicked']);
  });

  it('값 선택 상자에 있음 · 없음 · 발송 이력 없음이 나온다', async () => {
    const user = userEvent.setup();
    render(
      <ContactsFilterBar
        surveyId="sv-1"
        initialClauses={[{ source: 'system.link_click', value: 'not_clicked', op: null }]}
        columnCandidates={CANDIDATES}
        resultCodeOptions={[]}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: /검색어|값/ }));

    expect(await screen.findByRole('option', { name: '있음' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '없음' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '— (발송 이력 없음)' })).toBeInTheDocument();
  });
});
