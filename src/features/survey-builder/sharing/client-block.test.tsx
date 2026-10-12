import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./access-link-panel', () => ({
  AccessLinkPanel: ({ kind }: { kind: string }) => <div>링크 패널:{kind}</div>,
}));
vi.mock('./guests-block', () => ({
  GuestsBlock: () => <div>게스트 계정 부여</div>,
}));

import { ClientBlock } from './client-block';

/**
 * 공유 설정 모달의 클라이언트 블록 (ADR-0029).
 *
 * 클라이언트에게 여는 길이 둘인 **공존 창**의 모양이다 — 설문별 링크가 기본이고, 옛 게스트
 * 계정 부여는 두 번째 세그먼트로 남아 있다(입구를 닫는 것은 링크 콘솔이 선 뒤의 일이다).
 */
describe('ClientBlock', () => {
  it('처음 보이는 것은 클라이언트 링크다', () => {
    render(<ClientBlock surveyId="s-1" />);
    expect(screen.getByText('클라이언트')).toBeInTheDocument();
    expect(screen.getByText('링크 패널:client')).toBeInTheDocument();
    expect(screen.queryByText('게스트 계정 부여')).toBeNull();
  });

  it('게스트 계정으로 바꾸면 계정 부여 화면으로 갈린다', async () => {
    const user = userEvent.setup();
    render(<ClientBlock surveyId="s-1" />);

    await user.click(screen.getByRole('radio', { name: '게스트 계정' }));

    expect(screen.getByText('게스트 계정 부여')).toBeInTheDocument();
    expect(screen.queryByText('링크 패널:client')).toBeNull();
  });
});
