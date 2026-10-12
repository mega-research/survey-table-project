import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./access-link-panel', () => ({
  AccessLinkPanel: ({ kind }: { kind: string }) => <div>링크 패널:{kind}</div>,
}));

import { ClientBlock } from './client-block';

/**
 * 공유 설정 모달의 클라이언트 블록 (ADR-0029).
 *
 * 클라이언트에게 여는 길이 **링크 하나**다. 게스트 계정을 검색해 부여하던 두 번째 세그먼트는
 * 링크 콘솔이 선 뒤에 걷혔다 — 고르는 자리가 없으므로 세그먼트 줄 자체가 없다.
 */
describe('ClientBlock', () => {
  it('클라이언트 링크 패널만 선다', () => {
    render(<ClientBlock surveyId="s-1" />);
    expect(screen.getByText('클라이언트')).toBeInTheDocument();
    expect(screen.getByText('링크 패널:client')).toBeInTheDocument();
  });

  it('게스트 계정으로 가는 길이 없다 — 여는 방식을 고르는 자리가 없다', () => {
    render(<ClientBlock surveyId="s-1" />);
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByText(/게스트/)).toBeNull();
    expect(screen.queryByText(/계정/)).toBeNull();
  });
});
