import { afterEach, describe, expect, it, vi } from 'vitest';

import { generatePrivateToken } from '@/lib/survey-url';

describe('generatePrivateToken', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('crypto.randomUUID 결과를 그대로 반환한다', () => {
    const fixedUuid = '11111111-2222-4333-8444-555555555555';
    const spy = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue(fixedUuid);

    const token = generatePrivateToken();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(token).toBe(fixedUuid);
  });

  it('crypto.randomUUID 미지원 환경에서는 폴백 없이 throw 한다', () => {
    // crypto.randomUUID 가 없는 레거시 환경 모사 — Math.random 폴백이 제거되어야 throw.
    const originalRandomUUID = crypto.randomUUID;
    // @ts-expect-error 런타임에서 미지원 상황을 모사하기 위해 undefined 로 덮어쓴다.
    crypto.randomUUID = undefined;

    try {
      expect(() => generatePrivateToken()).toThrow();
    } finally {
      crypto.randomUUID = originalRandomUUID;
    }
  });

  it('Math.random 기반 폴백 분기를 사용하지 않는다', () => {
    const randomSpy = vi.spyOn(Math, 'random');

    generatePrivateToken();

    expect(randomSpy).not.toHaveBeenCalled();
  });
});
