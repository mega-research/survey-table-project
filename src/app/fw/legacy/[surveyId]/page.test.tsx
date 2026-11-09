/**
 * 옛 주소 다리의 비밀번호 화면 (fieldwork-multi-company 티켓 10).
 *
 * 어느 화면을 그릴지는 코어(`resolveLegacyBridgeEntry`, 실 DB 스위트가 본다)가 정한다. 여기서 보는
 * 것은 페이지만 지는 둘이다 — 허용 목록 밖이면 다리가 꺼진 자리(내부 콘솔 주소)로 보내고, 그리는
 * 화면에 **조사 이름·업체 목록·이름표가 없다**(설문 id 만 아는 사람 누구나 여는 화면이다).
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

const core = vi.hoisted(() => ({ entry: vi.fn() }));
vi.mock('@/server/access-link', () => ({ resolveLegacyBridgeEntry: core.entry }));

vi.mock('@/shared/lib/rpc', () => ({ client: {} }));

const SURVEY = '9f550d8b-24d2-4b19-b5d7-00684e0d8644';

async function renderPage(surveyId = SURVEY) {
  render(await LegacyBridgePasswordPage({ params: Promise.resolve({ surveyId }) }));
}

beforeEach(() => {
  core.entry.mockReset();
  nav.redirect.mockClear();
});

describe('옛 주소 다리 비밀번호 화면', () => {
  it('비밀번호 칸을 그리고, 조사 이름이나 업체를 가리키는 글자가 없다', async () => {
    core.entry.mockResolvedValue({ kind: 'password' });

    await renderPage();

    expect(screen.getByLabelText('접속 비밀번호')).toBeTruthy();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(document.body.textContent).not.toMatch(/업체|이름표|링크 \d/);
    expect(core.entry).toHaveBeenCalledWith(SURVEY);
  });

  it('닫힌 설문이면 닫힘 안내를 그리고 비밀번호 칸이 없다', async () => {
    core.entry.mockResolvedValue({ kind: 'closed' });

    await renderPage();

    expect(screen.getByText('접속이 닫혔습니다')).toBeTruthy();
    expect(screen.queryByLabelText('접속 비밀번호')).toBeNull();
  });

  it('허용 목록 밖 설문이면 다리가 꺼진 자리 — 내부 콘솔 주소로 보낸다', async () => {
    core.entry.mockResolvedValue(null);

    await expect(renderPage()).rejects.toThrow(`NEXT_REDIRECT:/surveys/${SURVEY}/operations`);
  });
});
