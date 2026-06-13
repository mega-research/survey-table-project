import { beforeEach, describe, expect, it, vi } from 'vitest';

// ========================
// 모듈 모킹
// ========================
// WS-3 lookup-pii-min #13: 미인증 unsubscribe lookup 이 평문 이메일 대신
// 마스킹된 이메일을 반환하는지 검증한다.
//
// 핵심 시나리오:
//   - cipher 가 정상 복호화되면 email 은 평문이 아니라 maskHint('email', plain) 결과여야 한다.
//   - 복호화가 throw 하면 email 은 null 로 유지된다(기존 동작 보존).
//   - cipher 자체가 없으면 email 은 null.
//
// db 는 drizzle fluent chain 흉내.
// select 체인: .from -> .leftJoin -> .where -> .orderBy -> .limit
// decryptPii 는 mock 으로 평문/throw 를 제어한다.

const { selectResultQueue } = vi.hoisted(() => ({
  selectResultQueue: [] as unknown[][],
}));

const decryptPiiMock = vi.fn<(token: string) => string>();

vi.mock('@/lib/crypto/aes', () => ({
  decryptPii: (token: string) => decryptPiiMock(token),
}));

vi.mock('@/db', () => {
  function shiftSelect(): unknown[] {
    return selectResultQueue.shift() ?? [];
  }

  function makeSelectChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    chain['from'] = vi.fn(() => chain);
    chain['leftJoin'] = vi.fn(() => chain);
    chain['where'] = vi.fn(() => chain);
    chain['orderBy'] = vi.fn(() => chain);
    chain['limit'] = vi.fn(() => Promise.resolve(shiftSelect()));
    return chain;
  }

  return {
    db: {
      select: vi.fn(() => makeSelectChain()),
    },
  };
});

import { lookupContactByToken } from '@/features/mail/server/services/mail-unsubscribe.service';

// 유효한 UUID v4 형식 토큰 (UUID_RE 통과용)
const VALID_TOKEN = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  selectResultQueue.length = 0;
  decryptPiiMock.mockReset();
});

describe('lookupContactByToken PII 마스킹 (#13)', () => {
  it('복호화 성공 시 평문 이메일을 노출하지 않고 마스킹해서 반환한다', async () => {
    const PLAIN = 'asdfghjk@naver.com';
    selectResultQueue.push([
      {
        id: 'ct-1',
        unsubscribedAt: null,
        cipher: 'v1:cipher-blob',
        columnKey: 'email',
      },
    ]);
    decryptPiiMock.mockReturnValue(PLAIN);

    const result = await lookupContactByToken({ token: VALID_TOKEN });

    expect(result.ok).toBe(true);
    // 평문이 그대로 새어나가면 안 된다.
    expect(result.email).not.toBe(PLAIN);
    // 마스킹 결과는 앞부분만 노출하는 형태여야 한다.
    expect(result.email).toBe('asd...@nav...');
  });

  it('복호화 실패 시 email 은 null 로 유지된다(기존 동작 보존)', async () => {
    selectResultQueue.push([
      {
        id: 'ct-1',
        unsubscribedAt: null,
        cipher: 'v1:corrupt-blob',
        columnKey: 'email',
      },
    ]);
    decryptPiiMock.mockImplementation(() => {
      throw new Error('decryptPii: bad payload');
    });

    const result = await lookupContactByToken({ token: VALID_TOKEN });

    expect(result.ok).toBe(true);
    expect(result.email).toBeNull();
  });

  it('cipher 가 없으면 email 은 null', async () => {
    selectResultQueue.push([
      {
        id: 'ct-1',
        unsubscribedAt: null,
        cipher: null,
        columnKey: null,
      },
    ]);

    const result = await lookupContactByToken({ token: VALID_TOKEN });

    expect(result.ok).toBe(true);
    expect(result.email).toBeNull();
    expect(decryptPiiMock).not.toHaveBeenCalled();
  });

  it('매칭 실패면 ok=false + email null', async () => {
    selectResultQueue.push([]);

    const result = await lookupContactByToken({ token: VALID_TOKEN });

    expect(result.ok).toBe(false);
    expect(result.email).toBeNull();
    expect(result.alreadyUnsubscribed).toBe(false);
  });
});
