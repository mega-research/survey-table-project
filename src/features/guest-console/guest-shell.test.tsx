import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GuestShell } from './guest-shell';

/**
 * 공통 셸의 헤더바 (ADR-0029, 티켓 06).
 *
 * 오른쪽 자리와 홈 링크는 **입구가 정한다.** 계정 입구는 프로필·로그아웃 메뉴와 홈(`/guest`)을
 * 넣고, 링크 입구는 「나가기」만 넣고 홈이 없다 — 링크 주체에게는 프로필도 계정 로그아웃도
 * 부여 설문 목록도 없다. 셸이 그것들을 직접 그리면 계정 모델을 import 하게 되고, 링크로
 * 들어온 클라이언트에게 로그인 화면으로 가는 버튼이 생긴다.
 */
describe('GuestShell — 오른쪽 자리와 홈 링크를 주입받는다', () => {
  it('주입받은 오른쪽 자리를 그대로 그린다', () => {
    render(
      <GuestShell homeHref="/guest" trailing={<button type="button">나가기</button>}>
        <p>본문</p>
      </GuestShell>,
    );
    expect(screen.getByRole('button', { name: '나가기' })).toBeInTheDocument();
    expect(screen.getByText('본문')).toBeInTheDocument();
  });

  it('홈 주소를 주면 로고가 그리로 간다', () => {
    render(
      <GuestShell homeHref="/guest" trailing={null}>
        <p>본문</p>
      </GuestShell>,
    );
    expect(screen.getByRole('link', { name: /메가허브/ })).toHaveAttribute('href', '/guest');
  });

  it('홈 주소가 없으면 로고는 링크가 아니다', () => {
    render(
      <GuestShell homeHref={null} trailing={null}>
        <p>본문</p>
      </GuestShell>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('메가허브')).toBeInTheDocument();
  });
});
