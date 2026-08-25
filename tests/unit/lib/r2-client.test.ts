import { describe, expect, it, vi } from 'vitest';

// r2-client 는 import 시점에 S3Client 를 만든다 — SDK 경계를 막아 둔다.
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = vi.fn();
  },
  HeadObjectCommand: class {},
}));

import { urlToR2Key } from '@/lib/r2-client';

// survey-image-promote 와 mail/services/image-promote 가 각각 갖고 있던 같은 구현의
// 테스트를 소유자 한 곳으로 합쳤다(케이스 합집합).
describe('urlToR2Key', () => {
  it('pathname 에서 leading slash 를 제거한다', () => {
    expect(urlToR2Key('https://cdn.test/tmp/survey/abc.webp')).toBe('tmp/survey/abc.webp');
  });

  it('영구 URL 도 key 를 뽑는다', () => {
    expect(urlToR2Key('https://cdn.test/mail/abc.webp')).toBe('mail/abc.webp');
  });

  it('중첩 경로도 처리한다', () => {
    expect(urlToR2Key('https://cdn.test/survey/dir/file.png')).toBe('survey/dir/file.png');
  });

  it('유효하지 않은 URL 은 null', () => {
    expect(urlToR2Key('not a url')).toBeNull();
  });

  it('빈 문자열은 null', () => {
    expect(urlToR2Key('')).toBeNull();
  });

  it('경로가 없는 URL 은 빈 문자열', () => {
    expect(urlToR2Key('https://cdn.test/')).toBe('');
  });
});
