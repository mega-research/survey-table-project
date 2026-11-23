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
import { HeaderFilterPopover } from '@/features/operations/filters/header-filter-popover';

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

  // 수신자 목록은 이메일 검색을 rq, 페이지를 recipPage 로 쓴다. 공용 헬퍼는 빌더
  // 파라미터(col/q/op)를 지우고 page 만 리셋하므로, 페이지별 이름을 알려주지 않으면
  // 깔때기 한 번에 검색어가 사라지고 페이지 번호가 남는다.
  it('renameOnApply — 적용 시 구 파라미터를 페이지 전용 이름으로 승격시킨다', async () => {
    listMock.mockResolvedValue({ values: ['상장'], truncated: false, hasEmpty: false });
    currentParams = new URLSearchParams('q=user@example.com');
    const user = userEvent.setup();
    renderPopover({ renameOnApply: { from: 'q', to: 'rq' } });

    await user.click(screen.getByRole('button', { name: '기업유형 필터' }));
    await waitFor(() => expect(screen.getByLabelText('상장')).toBeInTheDocument());
    await user.click(screen.getByLabelText('상장'));
    await user.click(screen.getByRole('button', { name: '적용' }));

    const p = pushedParams();
    expect(p.get('rq')).toBe('user@example.com');
    expect(p.get('q')).toBeNull();
  });

  it('resetParams — 적용 시 페이지 전용 페이지 파라미터를 리셋한다', async () => {
    listMock.mockResolvedValue({ values: ['상장'], truncated: false, hasEmpty: false });
    currentParams = new URLSearchParams('recipPage=7');
    const user = userEvent.setup();
    renderPopover({ resetParams: ['recipPage'] });

    await user.click(screen.getByRole('button', { name: '기업유형 필터' }));
    await waitFor(() => expect(screen.getByLabelText('상장')).toBeInTheDocument());
    await user.click(screen.getByLabelText('상장'));
    await user.click(screen.getByRole('button', { name: '적용' }));

    expect(pushedParams().get('recipPage')).toBeNull();
  });

  it('attrs 저카디널리티 — 열면 distinct 값 체크박스, 선택 후 적용 시 hcol/hm/hv 로 push', async () => {
    listMock.mockResolvedValue({ values: ['상장', '코스닥'], truncated: false, hasEmpty: false });
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

  it('onApplyParams — 적용 시 페이지 전용 파라미터 정리 (응답 내역 상태 select 모순 방지)', async () => {
    // status=completed 상태에서 상태 깔때기로 이탈을 걸면 상단 select 파라미터를
    // 지워야 completed AND IN drop 모순 0건이 안 난다. deleted(삭제 뷰)는 보존.
    currentParams = new URLSearchParams('status=completed');
    const user = userEvent.setup();
    renderPopover({
      source: 'status',
      label: '상태',
      fixedOptions: [{ value: 'drop', label: '이탈' }],
      onApplyParams: (p) => {
        if (p.get('status') !== 'deleted') p.delete('status');
      },
    });

    await user.click(screen.getByRole('button', { name: '상태 필터' }));
    await user.click(screen.getByLabelText('이탈'));
    await user.click(screen.getByRole('button', { name: '적용' }));

    const p = pushedParams();
    expect(p.getAll('hcol')).toEqual(['status']);
    expect(p.get('status')).toBeNull();
  });

  it('attrs 고카디널리티(truncated) — 부분검색 입력으로 폴백, 적용 시 hm=text', async () => {
    listMock.mockResolvedValue({ values: [], truncated: true, hasEmpty: false });
    const user = userEvent.setup();
    renderPopover();

    await user.click(screen.getByRole('button', { name: '기업유형 필터' }));
    const input = await screen.findByPlaceholderText(/검색어 또는 번호/);
    expect(screen.getByText(/고유값이 많아/)).toBeInTheDocument();

    await user.type(input, '제조');
    await user.click(screen.getByRole('button', { name: '적용' }));

    const p = pushedParams();
    expect(p.getAll('hm')).toEqual(['text']);
    expect(p.getAll('hv')).toEqual(['제조']);
  });

  it('textSearch — 값 목록 없이 부분검색 입력, 적용 시 hm=text (단체 메일 그룹 열)', async () => {
    const user = userEvent.setup();
    renderPopover({ source: 'system.group', label: '그룹', textSearch: true });

    await user.click(screen.getByRole('button', { name: '그룹 필터' }));
    expect(screen.getByText('고유값이 많아 검색으로 필터링합니다')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('검색어 (일부만 입력해도 찾습니다)'), '가비아');
    await user.click(screen.getByRole('button', { name: '적용' }));

    expect(listMock).not.toHaveBeenCalled();
    const p = pushedParams();
    expect(p.getAll('hcol')).toEqual(['system.group']);
    expect(p.getAll('hm')).toEqual(['text']);
    expect(p.getAll('hv')).toEqual(['가비아']);
  });

  // 단체 메일은 조건을 캠페인 스냅샷으로 다시 보낸다(필터 결과 전체 선택·발송). 스냅샷이 받는 길이를
  // 넘는 조건을 화면이 적용해 버리면 미리보기에는 걸리는데 전체 선택과 발송이 거부된다.
  it('maxValueLength — 고른 값을 이은 길이가 넘으면 적용하지 않고 줄이라고 알린다', async () => {
    const user = userEvent.setup();
    renderPopover({
      source: 'system.group',
      label: '그룹',
      fixedOptions: [
        { value: '가'.repeat(6), label: '첫째' },
        { value: '나'.repeat(6), label: '둘째' },
      ],
      maxValueLength: 12,
    });

    await user.click(screen.getByRole('button', { name: '그룹 필터' }));
    await user.click(screen.getByLabelText('첫째'));
    await user.click(screen.getByLabelText('둘째'));
    await user.click(screen.getByRole('button', { name: '적용' }));

    // 6 + 구분자 1 + 6 = 13자 > 12
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('고른 값이 너무 많습니다');

    // 하나를 풀면 안내가 사라지고 적용된다.
    await user.click(screen.getByLabelText('둘째'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '적용' }));
    expect(pushedParams().getAll('hv')).toEqual(['가'.repeat(6)]);
  });

  it('고정 옵션도 textSearch 도 없는 system.group 은 필터를 그리지 않는다', () => {
    renderPopover({ source: 'system.group', label: '그룹' });
    expect(screen.queryByRole('button', { name: '그룹 필터' })).not.toBeInTheDocument();
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

  it('pii 컬럼 — "— 제외하고 보기" 토글은 입력을 무시하고 센티널 단독 in 절로 나간다', async () => {
    const user = userEvent.setup();
    renderPopover({ source: 'pii.mobile', label: '전화번호', piiType: 'mobile' });

    await user.click(screen.getByRole('button', { name: '전화번호 필터' }));
    const input = await screen.findByPlaceholderText('정확한 값 입력 (부분 검색 불가)');
    await user.type(input, '010-1234-5678');
    await user.click(screen.getByLabelText('— 제외하고 보기'));
    expect(input).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '적용' }));

    const p = pushedParams();
    expect(p.getAll('hm')).toEqual(['in']);
    expect(p.getAll('hv')).toEqual(['__not_none__']);
  });

  it('두 빈 값 토글은 서로 배타 — 하나를 켜면 반대쪽이 꺼진다', async () => {
    const user = userEvent.setup();
    renderPopover({ source: 'pii.mobile', label: '전화번호', piiType: 'mobile' });

    await user.click(screen.getByRole('button', { name: '전화번호 필터' }));
    const emptyOnly = await screen.findByLabelText('— 인 것만 보기');
    const excludeEmpty = screen.getByLabelText('— 제외하고 보기');

    await user.click(emptyOnly);
    await user.click(excludeEmpty);
    expect(emptyOnly).not.toBeChecked();
    expect(excludeEmpty).toBeChecked();

    await user.click(screen.getByRole('button', { name: '적용' }));
    expect(pushedParams().getAll('hv')).toEqual(['__not_none__']);
  });

  it('빌더 필터 활성 상태에서 적용 — 경고 다이얼로그 확인 후 빌더 파라미터 제거', async () => {
    currentParams = new URLSearchParams('col=attrs.전시회명&q=핵심&op=');
    listMock.mockResolvedValue({ values: ['상장'], truncated: false, hasEmpty: false });
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
    listMock.mockResolvedValue({ values: ['상장', '코스닥'], truncated: false, hasEmpty: false });
    const user = userEvent.setup();
    renderPopover();

    await user.click(screen.getByRole('button', { name: '기업유형 필터' }));
    await user.click(await screen.findByRole('button', { name: '필터 해제' }));

    const p = pushedParams();
    expect(p.has('hcol')).toBe(false);
  });
});
