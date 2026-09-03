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

describe('ContactsFilterBar web 컬럼 신규 선택 기본값', () => {
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

  it("web 컬럼 선택 직후 검색하면 레거시 'true' 가 아닌 'completed' 로 검색된다", async () => {
    // 신규 선택 경로의 기본값이 레거시('true')면 새 사용자에게 구필터 항목이 뜨고
    // 서버는 respondedAt 이진 조건을 실행한다 — 상태 어휘 전환 의도와 어긋나는 회귀.
    const user = userEvent.setup();
    render(
      <ContactsFilterBar
        surveyId="sv-1"
        initialClauses={[]}
        columnCandidates={[
          { source: 'attrs.전시회명', label: '전시회명' },
          { source: 'system.web', label: 'web' },
        ]}
        resultCodeOptions={[]}
      />,
    );

    await user.click(screen.getByLabelText('검색 컬럼'));
    await user.click(await screen.findByRole('option', { name: 'web' }));
    await user.click(screen.getByRole('button', { name: '검색' }));

    const p = pushedParams();
    expect(p.getAll('col')).toEqual(['system.web']);
    expect(p.getAll('q')).toEqual(['completed']);
  });
});
