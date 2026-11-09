/**
 * 옛 주소 다리의 비밀번호 한 칸 (fieldwork-multi-company 티켓 10).
 *
 * 판정은 서버가 하고(실 DB 스위트 `legacy-guest-bridge.realdb`), 여기서 지키는 것은 화면만 지는 것이다.
 *  ① 성공하면 **다리 라우트로 돌아간다** — 응답에 토큰이 없으므로 화면은 링크 주소를 모른다. 라우트가
 *     방금 심은 쿠키 하나로 그 링크를 고른다.
 *  ② 틀림과 「둘 다 맞음」은 서버가 같은 `denied` 를 주므로 화면도 문구 하나다.
 *  ③ 닫힘은 새로 고쳐 서버가 닫힘 안내를 그리게 한다(`/fw` 입구와 같은 동선).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LegacyBridgePasswordForm } from './password-form';

const rpc = vi.hoisted(() => ({ authenticateLegacyBridge: vi.fn() }));
vi.mock('@/shared/lib/rpc', () => ({
  client: {
    workspace: { accessLinkSession: { authenticateLegacyBridge: rpc.authenticateLegacyBridge } },
  },
}));

const SURVEY = '9f550d8b-24d2-4b19-b5d7-00684e0d8644';
const originalLocation = window.location;
const location = { assign: vi.fn(), reload: vi.fn() };

beforeEach(() => {
  rpc.authenticateLegacyBridge.mockReset();
  location.assign.mockReset();
  location.reload.mockReset();
  Object.defineProperty(window, 'location', { configurable: true, value: location });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

function submit(password: string) {
  render(<LegacyBridgePasswordForm surveyId={SURVEY} />);
  fireEvent.change(screen.getByLabelText('접속 비밀번호'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: '들어가기' }));
}

describe('LegacyBridgePasswordForm', () => {
  it('설문 id 와 입력한 비밀번호로 다리 접속을 부르고, 성공하면 다리 라우트를 다시 지난다', async () => {
    rpc.authenticateLegacyBridge.mockResolvedValue({ ok: true });

    submit('PrimePass2026');

    await waitFor(() =>
      expect(location.assign).toHaveBeenCalledWith(`/api/legacy-guest-link/${SURVEY}`),
    );
    expect(rpc.authenticateLegacyBridge).toHaveBeenCalledWith({
      surveyId: SURVEY,
      password: 'PrimePass2026',
    });
  });

  it('거부되면 「비밀번호가 올바르지 않습니다」 하나를 보이고 이동하지 않는다', async () => {
    rpc.authenticateLegacyBridge.mockResolvedValue({ ok: false, reason: 'denied' });

    submit('Wrong2026pw');

    expect(await screen.findByText('비밀번호가 올바르지 않습니다.')).toBeTruthy();
    expect(location.assign).not.toHaveBeenCalled();
  });

  it('닫힘이면 새로 고쳐 서버가 닫힘 안내를 그리게 한다', async () => {
    rpc.authenticateLegacyBridge.mockResolvedValue({ ok: false, reason: 'closed' });

    submit('PrimePass2026');

    await waitFor(() => expect(location.reload).toHaveBeenCalled());
  });

  it('시도 제한에 걸리면 잠시 후 다시 하라고 말한다', async () => {
    rpc.authenticateLegacyBridge.mockRejectedValue({ code: 'TOO_MANY_REQUESTS' });

    submit('PrimePass2026');

    expect(
      await screen.findByText('시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.'),
    ).toBeTruthy();
  });
});
