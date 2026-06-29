import { describe, expect, it, vi } from 'vitest';

// image-utils 는 RPC client 를 import 하므로 import-time 부작용을 차단한다.
vi.mock('@/shared/lib/rpc', () => ({ client: {} }));

import { pickOptimizedMimeType } from '@/lib/image-utils';

describe('pickOptimizedMimeType', () => {
  it('PNG 는 투명도 보존을 위해 WebP 로 출력한다', () => {
    // 회귀: 과거에는 PNG 를 JPEG 로 강제 변환해 투명 영역이 검정으로 합성됐다.
    expect(pickOptimizedMimeType('image/png')).toBe('image/webp');
  });

  it('WebP 는 WebP 로 출력한다', () => {
    expect(pickOptimizedMimeType('image/webp')).toBe('image/webp');
  });

  it('JPEG 는 JPEG 로 출력한다', () => {
    expect(pickOptimizedMimeType('image/jpeg')).toBe('image/jpeg');
  });

  it('BMP 등 알파 없는 형식은 JPEG 로 출력한다', () => {
    expect(pickOptimizedMimeType('image/bmp')).toBe('image/jpeg');
    expect(pickOptimizedMimeType('')).toBe('image/jpeg');
  });
});
