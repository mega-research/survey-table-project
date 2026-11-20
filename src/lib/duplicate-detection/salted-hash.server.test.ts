import { describe, expect, it } from 'vitest';

import { hashClientIp, saltedHash } from './salted-hash.server';

// 기대값은 테스트 솔트(tests/setup.ts)로 셸에서 따로 계산한 것이다:
//   printf '%s' '203.0.113.7test-salt-do-not-use-in-prod' | shasum -a 256
const IP = '203.0.113.7';
const IP_HASH = '51dbb777aefab8a023dfb19fb1b0bda8ef91ed03d5494f256c8613d1a1a3dfd1';

describe('saltedHash', () => {
  it('입력 뒤에 솔트를 붙인 sha256 이다 — 이미 저장된 응답 해시와 같은 식', () => {
    expect(saltedHash(IP)).toBe(IP_HASH);
  });
});

describe('hashClientIp', () => {
  it('IP 의 해시를 낸다', () => {
    expect(hashClientIp(IP)).toBe(IP_HASH);
  });

  it('앞뒤 공백은 걷어 낸다', () => {
    expect(hashClientIp(` ${IP}\n`)).toBe(IP_HASH);
  });

  it('비어 있으면 null 이다', () => {
    expect(hashClientIp(null)).toBeNull();
    expect(hashClientIp(undefined)).toBeNull();
    expect(hashClientIp('   ')).toBeNull();
  });
});
