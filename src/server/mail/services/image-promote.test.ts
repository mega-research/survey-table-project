import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 파일 최상단 hoisted mock — promote 가 의존하는 R2 copier mock.
vi.mock('@/lib/image-utils-server', () => ({
  copyR2Objects: vi.fn(),
}));

// permanentObjectExists 가 사용하는 S3 client mock.
// recovery 경로(이미 영구 위치에 존재) 테스트를 위해 HeadObject 응답을 제어한다.
const headExistsKeys = new Set<string>();
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    async send(cmd: { input?: { Key?: string } }) {
      const key = cmd?.input?.Key;
      if (key && headExistsKeys.has(key)) return {};
      throw new Error('NotFound');
    }
  },
  HeadObjectCommand: class {
    input: { Bucket?: string; Key?: string };
    constructor(input: { Bucket?: string; Key?: string }) {
      this.input = input;
    }
  },
}));

import { copyR2Objects } from '@/lib/image-utils-server';
import {
  extractTmpMailUrls,
  MailImagePromoteError,
  promoteMailImages,
  tmpToPermanentUrl,
} from './image-promote';

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

describe('promoteMailImages — fail-closed', () => {
  beforeEach(() => {
    process.env['CLOUDFLARE_R2_PUBLIC_URL'] = 'https://cdn.test';
    process.env['CLOUDFLARE_R2_BUCKET'] = 'test-bucket';
    headExistsKeys.clear();
    vi.mocked(copyR2Objects).mockReset();
  });
  afterEach(() => {
    delete process.env['CLOUDFLARE_R2_PUBLIC_URL'];
    delete process.env['CLOUDFLARE_R2_BUCKET'];
    headExistsKeys.clear();
  });

  it('copy 실패 + HEAD(permanentObjectExists) 실패 → MailImagePromoteError throw, 실패 URL이 결과에 도달하지 않는다', async () => {
    vi.mocked(copyR2Objects).mockResolvedValue({
      movedKeys: [],
      failed: ['tmp/mail/a.webp'],
    });

    const bodyHtml = '<img src="https://cdn.test/tmp/mail/a.webp">';

    await expect(promoteMailImages(bodyHtml)).rejects.toThrow(MailImagePromoteError);
    await expect(promoteMailImages(bodyHtml)).rejects.toMatchObject({
      failedKeys: ['tmp/mail/a.webp'],
    });
  });

  it('copy 실패 + HEAD 성공(이전 promote가 이미 옮김) → throw 없이 치환이 완성된다', async () => {
    headExistsKeys.add('mail/a.webp');
    vi.mocked(copyR2Objects).mockResolvedValue({
      movedKeys: [],
      failed: ['tmp/mail/a.webp'],
    });

    const bodyHtml = '<img src="https://cdn.test/tmp/mail/a.webp">';
    const result = await promoteMailImages(bodyHtml);
    expect(result).toBe('<img src="https://cdn.test/mail/a.webp">');
  });
});
