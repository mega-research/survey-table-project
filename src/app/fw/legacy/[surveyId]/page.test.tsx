/**
 * 옛 주소 다리의 비밀번호 화면 (fieldwork-multi-company 티켓 10).
 *
 * 페이지가 지는 것은 둘이다 — 허용 목록 밖이면 다리가 꺼진 자리(내부 콘솔 주소)로 보내고, 그리는 화면에
 * **조사 이름·업체 목록·이름표·닫힘이 없다**(설문 id 만 아는 사람 누구나 여는 화면이다). 닫힘은 맞는
 * 비밀번호 뒤에 비밀번호 칸이 말한다(`password-form`).
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LegacyBridgePasswordPage from './page';

const nav = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));
vi.mock('next/navigation', () => ({ redirect: nav.redirect }));

const core = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('@/server/access-link', () => ({ isLegacyBridgeOpen: core.open }));

vi.mock('@/shared/lib/rpc', () => ({ client: {} }));

const SURVEY = '9f550d8b-24d2-4b19-b5d7-00684e0d8644';

async function renderPage(surveyId = SURVEY) {
  render(await LegacyBridgePasswordPage({ params: Promise.resolve({ surveyId }) }));
}

beforeEach(() => {
  core.open.mockReset();
  nav.redirect.mockClear();
});

describe('옛 주소 다리 비밀번호 화면', () => {
  it('비밀번호 칸을 그리고, 조사 이름이나 업체를 가리키는 글자가 없다', async () => {
    core.open.mockReturnValue(true);

    await renderPage();

    expect(screen.getByLabelText('접속 비밀번호')).toBeTruthy();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(document.body.textContent).not.toMatch(/업체|이름표|링크 \d|닫혔/);
    expect(core.open).toHaveBeenCalledWith(SURVEY);
  });

  it('허용 목록 밖 설문이면 다리가 꺼진 자리 — 내부 콘솔 주소로 보낸다', async () => {
    core.open.mockReturnValue(false);

    await expect(renderPage()).rejects.toThrow(`NEXT_REDIRECT:/surveys/${SURVEY}/operations`);
  });
});
