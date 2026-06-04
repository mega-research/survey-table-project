import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  extractTmpMailUrls,
  tmpToPermanentUrl,
  urlToR2Key,
} from '@/lib/mail/mail-image-promote';

describe('extractTmpMailUrls', () => {
  beforeEach(() => {
    process.env['CLOUDFLARE_R2_PUBLIC_URL'] = 'https://cdn.test';
  });

  afterEach(() => {
    delete process.env['CLOUDFLARE_R2_PUBLIC_URL'];
  });

  it('tmp/mail/ URL만 반환', () => {
    const html = `
      <img src="https://cdn.test/tmp/mail/abc.webp">
      <img src="https://cdn.test/mail/old.webp">
      <img src="https://cdn.test/tmp/survey/x.webp">
      <img src="https://external.com/img.png">
    `;
    expect(extractTmpMailUrls(html)).toEqual(['https://cdn.test/tmp/mail/abc.webp']);
  });

  it('빈 html이면 빈 배열 반환', () => {
    expect(extractTmpMailUrls('')).toEqual([]);
  });

  it('중복 URL 제거', () => {
    const html = `
      <img src="https://cdn.test/tmp/mail/abc.webp">
      <img src="https://cdn.test/tmp/mail/abc.webp">
    `;
    expect(extractTmpMailUrls(html)).toEqual(['https://cdn.test/tmp/mail/abc.webp']);
  });

  it('영구 mail/ URL은 무시', () => {
    const html = '<img src="https://cdn.test/mail/abc.webp">';
    expect(extractTmpMailUrls(html)).toEqual([]);
  });

  it('다른 kind의 tmp URL은 무시 (tmp/survey/)', () => {
    const html = '<img src="https://cdn.test/tmp/survey/img.webp">';
    expect(extractTmpMailUrls(html)).toEqual([]);
  });

  it('외부 URL은 무시', () => {
    const html = '<img src="https://external.com/tmp/mail/abc.webp">';
    expect(extractTmpMailUrls(html)).toEqual([]);
  });

  it('여러 tmp/mail/ URL 모두 반환', () => {
    const html = `
      <img src="https://cdn.test/tmp/mail/a.webp">
      <img src="https://cdn.test/tmp/mail/b.png">
    `;
    expect(extractTmpMailUrls(html)).toEqual([
      'https://cdn.test/tmp/mail/a.webp',
      'https://cdn.test/tmp/mail/b.png',
    ]);
  });

  it('img 태그 없으면 빈 배열', () => {
    const html = '<p>텍스트만 있습니다</p>';
    expect(extractTmpMailUrls(html)).toEqual([]);
  });
});

describe('tmpToPermanentUrl', () => {
  beforeEach(() => {
    process.env['CLOUDFLARE_R2_PUBLIC_URL'] = 'https://cdn.test';
  });

  afterEach(() => {
    delete process.env['CLOUDFLARE_R2_PUBLIC_URL'];
  });

  it('tmp/mail/ prefix를 mail/로 치환', () => {
    expect(tmpToPermanentUrl('https://cdn.test/tmp/mail/abc.webp')).toBe(
      'https://cdn.test/mail/abc.webp',
    );
  });

  it('경로에 서브폴더가 있어도 정확히 치환', () => {
    expect(tmpToPermanentUrl('https://cdn.test/tmp/mail/2024/01/abc.webp')).toBe(
      'https://cdn.test/mail/2024/01/abc.webp',
    );
  });
});

describe('urlToR2Key', () => {
  it('pathname에서 leading slash 제거하여 반환', () => {
    expect(urlToR2Key('https://cdn.test/tmp/mail/abc.webp')).toBe('tmp/mail/abc.webp');
  });

  it('영구 URL도 key 추출', () => {
    expect(urlToR2Key('https://cdn.test/mail/abc.webp')).toBe('mail/abc.webp');
  });

  it('유효하지 않은 URL이면 null 반환', () => {
    expect(urlToR2Key('not a url')).toBe(null);
  });

  it('빈 문자열이면 null 반환', () => {
    expect(urlToR2Key('')).toBe(null);
  });

  it('경로가 없는 URL은 빈 문자열 반환', () => {
    expect(urlToR2Key('https://cdn.test/')).toBe('');
  });
});
