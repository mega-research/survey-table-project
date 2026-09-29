import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/surveys/sv-1/operations/contacts',
  useSearchParams: () => new URLSearchParams(),
}));

import { OperationsPageHeader } from '@/features/operations/operations-page-header';
import { surveyCapabilityValues, type SurveyCapability } from '@/shared/contracts/workspace';
import { LINK_CAPABILITIES } from '@tests/fixtures/survey-capability-columns';

/**
 * 헤더의 자리는 **두 축**이 정한다 (ADR-0026 티켓 02·06).
 *  - `capabilities` — 설문을 고칠 수 있는가(`survey.edit`). 중단·테스트 모드·편집이 한 묶음이다.
 *  - `internalShell` — 어느 셸에 있는가. 설문 목록·빌더 미리보기·로그아웃은 admin 주소·계정
 *    동작이라 capability 로 물을 수 없다.
 *
 * 외주 실사 링크 셸에 남는 것은 **새로고침과 나가기 둘**이고, 「나가기」는 계정 로그아웃이
 * 아니라 쿠키 하나를 지우는 다른 동작이라 슬롯으로 들어온다.
 */

const CONTROL = {
  isPaused: false,
  pausedMessage: null,
  testModeEnabled: false,
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
  options: { internalShell?: boolean; trailing?: React.ReactNode } = {},
) {
  const queryClient = new QueryClient();
  return rtlRender(
    <OperationsPageHeader
      surveyId="sv-1"
      surveyTitle="외주 실사 조사"
      capabilities={new Set(capabilities)}
      internalShell={options.internalShell ?? true}
      {...(options.trailing !== undefined ? { trailing: options.trailing } : {})}
      {...(options.internalShell === false ? {} : { control: CONTROL })}
    />,
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    },
  );
}

/** 링크 셸에 있어서는 안 되는 자리들. */
const INTERNAL_ONLY = ['목록으로', '설문 보기', '설문 편집'];

describe('OperationsPageHeader — 링크 셸에는 새로고침과 나가기만 남는다', () => {
  it('전권 내부 주체는 admin 자리를 전부 본다', () => {
    renderHeader(surveyCapabilityValues);
    for (const label of INTERNAL_ONLY) {
      expect(screen.queryAllByText(label).length, `${label} 가 없다`).toBeGreaterThan(0);
    }
  });

  it('외주 링크 셸에는 admin 자리가 하나도 없다', () => {
    renderHeader(LINK_CAPABILITIES, {
      internalShell: false,
      trailing: <button type="button">나가기</button>,
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
