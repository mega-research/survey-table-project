/**
 * 세션 폐기 표식의 판정 규칙 (역할 모델 v2 티켓 30).
 *
 * 규칙은 하나다 — 흐름이 시작될 때 읽어둔 값과 세션을 만들 때의 값이 다르면 그 사이 폐기가
 * 있었다는 뜻이므로 막는다. 시각의 대소가 아니라 **바뀌었는지**만 본다(시계 오차 무관).
 */
import { describe, expect, it } from 'vitest';

import {
  getSessionRevocationMark,
  isSessionCreationStale,
  runWithSessionRevocationMark,
  setSessionRevocationMark,
} from './session-revocation';

const USER = 'user-1';
const T1 = new Date('2026-08-26T00:00:00.000Z');
const T2 = new Date('2026-08-26T00:00:01.000Z');

describe('isSessionCreationStale', () => {
  it('표식이 없으면 판정하지 않는다 (fail-open)', async () => {
    // 세션을 만드는 경로가 로그인만은 아니다 — 근거가 없을 때 막으면 정상 로그인을 잃는다.
    expect(isSessionCreationStale(USER, T1)).toBe(false);
  });

  it('시작 시점과 같으면 통과한다', async () => {
    await runWithSessionRevocationMark(async () => {
      setSessionRevocationMark({ userId: USER, revokedAt: T1 });
      expect(isSessionCreationStale(USER, T1)).toBe(false);
    });
  });

  it('폐기된 적 없던 계정이 그대로면 통과한다', async () => {
    await runWithSessionRevocationMark(async () => {
      setSessionRevocationMark({ userId: USER, revokedAt: null });
      expect(isSessionCreationStale(USER, null)).toBe(false);
    });
  });

  it('흐름 도중 값이 바뀌면 막는다', async () => {
    await runWithSessionRevocationMark(async () => {
      setSessionRevocationMark({ userId: USER, revokedAt: null });
      expect(isSessionCreationStale(USER, T1)).toBe(true);
    });
  });

  it('이미 폐기된 적 있는 계정에서 또 폐기돼도 막는다', async () => {
    await runWithSessionRevocationMark(async () => {
      setSessionRevocationMark({ userId: USER, revokedAt: T1 });
      expect(isSessionCreationStale(USER, T2)).toBe(true);
    });
  });

  it('같은 시각의 다른 Date 인스턴스는 같은 값으로 본다', async () => {
    await runWithSessionRevocationMark(async () => {
      setSessionRevocationMark({ userId: USER, revokedAt: new Date(T1) });
      expect(isSessionCreationStale(USER, new Date(T1))).toBe(false);
    });
  });

  it('다른 사용자의 세션 생성에는 적용하지 않는다', async () => {
    await runWithSessionRevocationMark(async () => {
      setSessionRevocationMark({ userId: USER, revokedAt: null });
      expect(isSessionCreationStale('other-user', T1)).toBe(false);
    });
  });
});

describe('setSessionRevocationMark — 먼저 찍힌 것이 이긴다', () => {
  it('두 번째 스탬프는 무시된다', async () => {
    // 흐름 도중 다시 읽어 덮으면 그 사이 일어난 폐기가 증거째 지워진다 — 막으려던 경합이
    // 정확히 그 창에서 일어난다.
    await runWithSessionRevocationMark(async () => {
      setSessionRevocationMark({ userId: USER, revokedAt: null });
      setSessionRevocationMark({ userId: USER, revokedAt: T1 });
      expect(getSessionRevocationMark()).toMatchObject({ revokedAt: null });
      expect(isSessionCreationStale(USER, T1)).toBe(true);
    });
  });

  it('저장소 밖의 스탬프는 아무 일도 하지 않는다', () => {
    setSessionRevocationMark({ userId: USER, revokedAt: T1 });
    expect(getSessionRevocationMark()).toBeNull();
  });

  it('흐름끼리 서로의 표식을 보지 않는다', async () => {
    await Promise.all([
      runWithSessionRevocationMark(async () => {
        setSessionRevocationMark({ userId: 'a', revokedAt: null });
        await new Promise((r) => setTimeout(r, 5));
        expect(getSessionRevocationMark()).toMatchObject({ userId: 'a' });
      }),
      runWithSessionRevocationMark(async () => {
        setSessionRevocationMark({ userId: 'b', revokedAt: T1 });
        await new Promise((r) => setTimeout(r, 1));
        expect(getSessionRevocationMark()).toMatchObject({ userId: 'b' });
      }),
    ]);
  });
});
