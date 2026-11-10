/**
 * 옛 주소 다리 비밀번호 판정의 허용 목록 관문 (fieldwork-multi-company 티켓 10).
 *
 * 판정 자체(정확히 하나가 맞을 때만, 종료된 링크 제외, 닫힘)는 실 DB 스위트
 * (`tests/integration/legacy-guest-bridge.realdb.test.ts`)가 본다. 여기서 지키는 것은 그 스위트가
 * 볼 수 없는 하나다 — **허용 목록 밖의 설문은 DB 를 묻지조차 않는다.** 결과(denied)만 보면 조회를
 * 하고 버려도 통과하므로 DB 자리를 세어야 한다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { authenticateLegacyBridge, isLegacyBridgeOpen } from './access-link';

const dbCalls = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock('@/db', () => ({
  db: {
    select: (...args: unknown[]) => {
      dbCalls.select(...args);
      throw new Error('허용 목록 밖에서 DB 를 물었다');
    },
  },
}));

const GRANTED = '9f550d8b-24d2-4b19-b5d7-00684e0d8644';
const OTHER = '11111111-2222-4333-8444-555555555555';
const GUEST = '7ea4b5f9-a128-474c-bf87-270498629281';

afterEach(() => {
  vi.unstubAllEnvs();
  dbCalls.select.mockReset();
});

describe('authenticateLegacyBridge — 허용 목록 관문', () => {
  it('허용 목록 밖의 설문은 DB 를 묻지 않고 denied 다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', `${GUEST}:${GRANTED}`);

    await expect(authenticateLegacyBridge(OTHER, 'Probe2026pw')).resolves.toEqual({
      ok: false,
      reason: 'denied',
    });
    expect(dbCalls.select).not.toHaveBeenCalled();
  });

  it('허용 목록이 비면 어떤 설문도 DB 를 묻지 않는다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', '');

    await expect(authenticateLegacyBridge(GRANTED, 'Probe2026pw')).resolves.toEqual({
      ok: false,
      reason: 'denied',
    });
    expect(dbCalls.select).not.toHaveBeenCalled();
  });

  it('설문 id 모양이 아닌 값도 DB 에 닿지 않는다', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', `${GUEST}:${GRANTED}`);

    await expect(authenticateLegacyBridge("x' OR 1=1 --", 'Probe2026pw')).resolves.toEqual({
      ok: false,
      reason: 'denied',
    });
    expect(dbCalls.select).not.toHaveBeenCalled();
  });

  it('허용 목록의 설문은 대문자로 와도 목록과 맞춰 DB 를 묻는다 — 관문이 실제로 열리는 쪽', async () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', `${GUEST}:${GRANTED}`);

    await expect(authenticateLegacyBridge(GRANTED.toUpperCase(), 'Probe2026pw')).rejects.toThrow(
      '허용 목록 밖에서 DB 를 물었다',
    );
    expect(dbCalls.select).toHaveBeenCalledTimes(1);
  });

  it('다리 비밀번호 화면의 입구는 DB 를 묻지 않는다 — 허용 목록만 본다(닫힘은 맞는 비밀번호 뒤에만 말한다)', () => {
    vi.stubEnv('GUEST_SURVEY_GRANTS', `${GUEST}:${GRANTED}`);

    expect(isLegacyBridgeOpen(OTHER)).toBe(false);
    expect(isLegacyBridgeOpen(GRANTED.toUpperCase())).toBe(true);
    expect(dbCalls.select).not.toHaveBeenCalled();
  });
});
