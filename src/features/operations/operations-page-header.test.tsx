import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LINK_CAPABILITIES } from '@tests/fixtures/survey-capability-columns';
import { describe, expect, it, vi } from 'vitest';

import { OperationsPageHeader } from '@/features/operations/operations-page-header';
import { type SurveyCapability, surveyCapabilityValues } from '@/shared/contracts/workspace';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/surveys/sv-1/operations/contacts',
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * 헤더의 자리는 **두 축**이 정한다 (ADR-0026 티켓 02·06).
 *  - `capabilities` — 설문을 고칠 수 있는가(`survey.edit`). 중단·테스트 모드·편집이 한 묶음이다.
 *  - `internalShell` — 어느 셸에 있는가. 설문 목록·빌더 미리보기·로그아웃은 admin 주소·계정
 *    동작이라 capability 로 물을 수 없다.
 *
 * 외주 실사 링크 셸에 남는 것은 **새로고침·설문 보기·나가기**다. 「나가기」는 계정 로그아웃이
 * 아니라 쿠키 하나를 지우는 다른 동작이라 슬롯으로 들어오고, 「설문 보기」는 admin 미리보기가
 * 아니라 링크 트리의 열람 화면으로 가도록 셸이 주소를 준다(`previewHref`, ADR-0027 이후).
 */

const CONTROL = {
  isPaused: false,
  pausedMessage: null,
  isClosed: false,
  testModeEnabled: false,
  testViewInBrowser: false,
  testToken: null,
  accessIdentifier: 'sv-1',
  testResponseCount: 0,
  testTargetCount: 0,
  firstTestInviteCode: null,
};

/**
 * 제어 버튼(테스트 모드)이 `useMutation` 을 쓴다 — 헤더를 통째로 렌더하려면 provider 가 있어야
 * 한다. 링크 셸에서는 그 버튼이 아예 안 그려지므로 provider 가 필요 없지만, 두 경우를 같은
 * 래퍼로 두어야 「provider 를 뺐더니 통과하더라」가 생기지 않는다.
 */
function renderHeader(
  capabilities: readonly SurveyCapability[],
  options: {
    internalShell?: boolean;
    trailing?: React.ReactNode;
    previewHref?: string;
    shareAction?: React.ReactNode;
  } = {},
) {
  const queryClient = new QueryClient();
  return rtlRender(
    <OperationsPageHeader
      surveyId="sv-1"
      surveyTitle="외주 실사 조사"
      capabilities={new Set(capabilities)}
      internalShell={options.internalShell ?? true}
      {...(options.trailing !== undefined ? { trailing: options.trailing } : {})}
      {...(options.previewHref !== undefined ? { previewHref: options.previewHref } : {})}
      {...(options.shareAction !== undefined ? { shareAction: options.shareAction } : {})}
      {...(options.internalShell === false ? {} : { control: CONTROL })}
    />,
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    },
  );
}

/** 링크 셸에 있어서는 안 되는 자리들 — 「설문 열기」는 편집이 든 메뉴라 내부 셸에만 선다. */
const INTERNAL_ONLY = ['목록으로', '설문 열기'];

describe('OperationsPageHeader — 링크 셸에는 새로고침과 나가기만 남는다', () => {
  it('전권 내부 주체는 admin 자리를 전부 본다', () => {
    renderHeader(surveyCapabilityValues);
    for (const label of INTERNAL_ONLY) {
      expect(screen.queryAllByText(label).length, `${label} 가 없다`).toBeGreaterThan(0);
    }
  });

  it('내부 셸의 설문 보기·편집은 「설문 열기」 메뉴 하나에 있다', async () => {
    const user = userEvent.setup();
    renderHeader(surveyCapabilityValues);
    expect(screen.queryByText('설문 보기')).toBeNull();

    await user.click(screen.getByRole('button', { name: /설문 열기/ }));
    const menu = await screen.findByRole('menu');
    // 내부 셸의 설문 보기는 빌더 미리보기로 간다.
    expect(within(menu).getByRole('menuitem', { name: /설문 보기/ })).toHaveAttribute(
      'href',
      '/surveys/sv-1/preview',
    );
    expect(within(menu).getByRole('menuitem', { name: /설문 편집/ })).toHaveAttribute(
      'href',
      '/surveys/sv-1/edit',
    );
  });

  it('편집 권한이 없으면 메뉴 대신 설문 보기 버튼 하나다', () => {
    renderHeader(surveyCapabilityValues.filter((cap) => cap !== 'survey.edit'));
    expect(screen.queryByRole('button', { name: /설문 열기/ })).toBeNull();
    expect(screen.getByText('설문 보기').closest('a')?.getAttribute('href')).toBe(
      '/surveys/sv-1/preview',
    );
  });

  it('공유 자리에 셸이 준 것을 그린다', () => {
    renderHeader(surveyCapabilityValues, { shareAction: <button type="button">공유</button> });
    expect(screen.getByRole('button', { name: '공유' })).toBeTruthy();
  });

  it('외주 링크 셸의 설문 보기는 링크 트리의 열람 화면으로 간다 — admin 주소가 아니다', () => {
    renderHeader(LINK_CAPABILITIES, { internalShell: false, previewHref: '/fw/tok/preview' });
    expect(screen.getByText('설문 보기').closest('a')?.getAttribute('href')).toBe(
      '/fw/tok/preview',
    );
  });

  it('링크 셸에 주소를 주지 않으면 설문 보기가 없다 — admin 미리보기로 새지 않는다', () => {
    renderHeader(LINK_CAPABILITIES, { internalShell: false });
    expect(screen.queryAllByText('설문 보기')).toEqual([]);
  });

  it('외주 링크 셸에는 admin 자리가 하나도 없다', () => {
    renderHeader(LINK_CAPABILITIES, {
      internalShell: false,
      trailing: <button type="button">나가기</button>,
      previewHref: '/fw/tok/preview',
    });
    for (const label of INTERNAL_ONLY) {
      expect(screen.queryAllByText(label), `${label} 가 외주에게 보인다`).toEqual([]);
    }
    // 남는 둘 — 제목은 자리가 아니라 정보다.
    expect(screen.getByText('새로고침')).toBeTruthy();
    expect(screen.getByText('나가기')).toBeTruthy();
    expect(screen.getByText('외주 실사 조사')).toBeTruthy();
  });

  it('제어 상태를 주지 않아도 터지지 않는다 — 링크 셸은 그 재료를 읽지 않는다', () => {
    // `control` 이 필수이던 시절에는 링크 레이아웃이 쓰지도 않을 제어 상태를 한 번 더
    // 읽어야 했다. 없어도 되는 것이 계약이라 그 사실을 여기서 못 박는다.
    renderHeader(LINK_CAPABILITIES, { internalShell: false });
    expect(screen.getByText('새로고침')).toBeTruthy();
  });
});

describe('OperationsPageHeader — 설문 종료는 중단과 같은 자리·같은 자격이다 (ADR-0030)', () => {
  // 중단·종료는 한 버튼의 메뉴 토글 둘이다 — 버튼이 보이면 둘 다 누를 수 있다.
  const STATUS_BUTTON = /^설문 (중|중단|종료)/;

  it('설문을 고칠 수 있는 주체에게 중단·종료 메뉴 버튼이 보인다', () => {
    renderHeader(surveyCapabilityValues);
    expect(screen.getByRole('button', { name: STATUS_BUTTON })).toBeTruthy();
  });

  it('survey.edit 이 없으면 보이지 않는다 — 한쪽만 누를 수 있는 사람이 없다', () => {
    renderHeader(surveyCapabilityValues.filter((cap) => cap !== 'survey.edit'));
    expect(screen.queryByRole('button', { name: STATUS_BUTTON })).toBeNull();
  });

  it('외주 링크 셸에는 중단·종료 메뉴가 없다', () => {
    renderHeader(LINK_CAPABILITIES, { internalShell: false });
    expect(screen.queryByRole('button', { name: STATUS_BUTTON })).toBeNull();
  });
});
