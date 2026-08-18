import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pushMock = vi.fn();
let currentParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/admin/surveys/sv-1/operations/contacts',
  useSearchParams: () => currentParams,
}));

vi.mock('@/shared/lib/rpc', () => ({
  client: {
    contacts: {
      attrValues: {
        list: vi.fn(),
      },
    },
  },
}));

import { client } from '@/shared/lib/rpc';
import { HeaderFilterPopover } from '@/components/operations/filters/header-filter-popover';

const listMock = vi.mocked(client.contacts.attrValues.list);

function renderPopover(props?: Partial<Parameters<typeof HeaderFilterPopover>[0]>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <HeaderFilterPopover
        surveyId="00000000-0000-4000-8000-000000000001"
        source="attrs.기업유형"
        label="기업유형"
        resultCodeOptions={[]}
        {...props}
      />
    </QueryClientProvider>,
  );
}

/** router.push 마지막 호출 URL 의 쿼리를 파싱한다. */
function pushedParams(): URLSearchParams {
  const lastCall = pushMock.mock.calls.at(-1);
  if (!lastCall) throw new Error('router.push 미호출');
  const url = String(lastCall[0]);
  return new URLSearchParams(url.split('?')[1] ?? '');
}

describe('HeaderFilterPopover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentParams = new URLSearchParams();
  });

  it('attrs 저카디널리티 — 열면 distinct 값 체크박스, 선택 후 적용 시 hcol/hm/hv 로 push', async () => {
    listMock.mockResolvedValue({ values: ['상장', '코스닥'], truncated: false });
    const user = userEvent.setup();
    renderPopover();

    await user.click(screen.getByRole('button', { name: '기업유형 필터' }));
    await waitFor(() => expect(screen.getByLabelText('상장')).toBeInTheDocument());

    await user.click(screen.getByLabelText('상장'));
    await user.click(screen.getByRole('button', { name: '적용' }));

    const p = pushedParams();
    expect(p.getAll('hcol')).toEqual(['attrs.기업유형']);
    expect(p.getAll('hm')).toEqual(['in']);
    expect(p.getAll('hv')).toEqual(['상장']);
  });

  it('fixedOptions — distinct 조회 없이 고정 옵션 체크박스, 적용 시 hcol/hm/hv 로 push', async () => {
    // 응답 내역 status 깔때기처럼 페이지 전용 source 를 고정 옵션으로 필터링하는 경로.
    const user = userEvent.setup();
    renderPopover({
      source: 'status',
      label: '상태',
      fixedOptions: [
        { value: 'completed', label: '완료' },
        { value: 'drop', label: '이탈' },
      ],
    });

    await user.click(screen.getByRole('button', { name: '상태 필터' }));
    await user.click(screen.getByLabelText('이탈'));
    await user.click(screen.getByRole('button', { name: '적용' }));

    expect(listMock).not.toHaveBeenCalled();
    const p = pushedParams();
    expect(p.getAll('hcol')).toEqual(['status']);
    expect(p.getAll('hm')).toEqual(['in']);
    expect(p.getAll('hv')).toEqual(['drop']);
  });

  it('attrs 고카디널리티(truncated) — 부분검색 입력으로 폴백, 적용 시 hm=text', async () => {
    listMock.mockResolvedValue({ values: [], truncated: true });
    const user = userEvent.setup();
    renderPopover();

    await user.click(screen.getByRole('button', { name: '기업유형 필터' }));
    const input = await screen.findByPlaceholderText(/검색어 또는 범위/);
    expect(screen.getByText(/고유값이 많아/)).toBeInTheDocument();

    await user.type(input, '제조');
    await user.click(screen.getByRole('button', { name: '적용' }));

    const p = pushedParams();
    expect(p.getAll('hm')).toEqual(['text']);
    expect(p.getAll('hv')).toEqual(['제조']);
  });

  it('pii 컬럼 — distinct 조회 없이 전문 일치 입력, 적용 시 hm=exact', async () => {
    const user = userEvent.setup();
    renderPopover({ source: 'pii.mobile', label: '전화번호', piiType: 'mobile' });

    await user.click(screen.getByRole('button', { name: '전화번호 필터' }));
    const input = await screen.findByPlaceholderText('정확한 값 입력 (부분 검색 불가)');
    expect(listMock).not.toHaveBeenCalled();

    await user.type(input, '010-1234-5678');
    await user.click(screen.getByRole('button', { name: '적용' }));

    const p = pushedParams();
    expect(p.getAll('hcol')).toEqual(['pii.mobile']);
    expect(p.getAll('hm')).toEqual(['exact']);
    expect(p.getAll('hv')).toEqual(['010-1234-5678']);
  });

  it('빌더 필터 활성 상태에서 적용 — 경고 다이얼로그 확인 후 빌더 파라미터 제거', async () => {
    currentParams = new URLSearchParams('col=attrs.전시회명&q=핵심&op=');
    listMock.mockResolvedValue({ values: ['상장'], truncated: false });
    const user = userEvent.setup();
    renderPopover();

    await user.click(screen.getByRole('button', { name: '기업유형 필터' }));
    await user.click(await screen.findByLabelText('상장'));
    await user.click(screen.getByRole('button', { name: '적용' }));

    // 경고 다이얼로그가 먼저 뜨고 아직 push 되지 않는다.
    expect(pushMock).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: '헤더 필터 적용' }));

    const p = pushedParams();
    expect(p.has('col')).toBe(false);
    expect(p.has('q')).toBe(false);
    expect(p.getAll('hcol')).toEqual(['attrs.기업유형']);
  });

  it('distinct 조회 실패 시 빈 화면 대신 오류 안내를 표시한다', async () => {
    listMock.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    renderPopover();

    await user.click(screen.getByRole('button', { name: '기업유형 필터' }));
    expect(await screen.findByText('값을 불러오지 못했습니다')).toBeInTheDocument();
  });

  it('활성 필터가 있으면 해제 버튼으로 제거할 수 있다', async () => {
    currentParams = new URLSearchParams('hcol=attrs.기업유형&hm=in&hv=상장');
    listMock.mockResolvedValue({ values: ['상장', '코스닥'], truncated: false });
    const user = userEvent.setup();
    renderPopover();

    await user.click(screen.getByRole('button', { name: '기업유형 필터' }));
    await user.click(await screen.findByRole('button', { name: '필터 해제' }));

    const p = pushedParams();
    expect(p.has('hcol')).toBe(false);
  });
});
