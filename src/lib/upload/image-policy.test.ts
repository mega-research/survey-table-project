import { describe, expect, it } from 'vitest';

import {
  IMAGE_KIND_TO_EXT,
  imageKindToExt,
  sanitizeImageExt,
  svgBodyHasScript,
} from '@/lib/upload/image-policy';

describe('imageKindToExt', () => {
  it('감지된 MIME 으로 확장자 결정 (파일명 비의존)', () => {
    expect(imageKindToExt('image/jpeg')).toBe('jpg');
    expect(imageKindToExt('image/png')).toBe('png');
    expect(imageKindToExt('image/gif')).toBe('gif');
    expect(imageKindToExt('image/webp')).toBe('webp');
    expect(imageKindToExt('image/bmp')).toBe('bmp');
    expect(imageKindToExt('image/svg+xml')).toBe('svg');
  });
  it('알 수 없는 MIME 은 null', () => {
    expect(imageKindToExt('application/octet-stream')).toBeNull();
    expect(imageKindToExt('')).toBeNull();
  });
  it('IMAGE_KIND_TO_EXT 매핑 노출', () => {
    expect(IMAGE_KIND_TO_EXT['image/jpeg']).toBe('jpg');
  });
});

describe('sanitizeImageExt', () => {
  it('정상 확장자는 소문자 영숫자만 유지', () => {
    expect(sanitizeImageExt('PNG')).toBe('png');
    expect(sanitizeImageExt('jpeg')).toBe('jpeg');
  });
  it('path traversal / 특수문자 → 안전 키 (영숫자만 추출)', () => {
    expect(sanitizeImageExt('../../etc/passwd')).toBe('etcpasswd'.slice(0, 16));
    expect(sanitizeImageExt('png; rm -rf')).toBe('pngrmrf');
    expect(sanitizeImageExt('a/b\\c')).toBe('abc');
  });
  it('16자로 절단', () => {
    expect(sanitizeImageExt('a'.repeat(40))).toBe('a'.repeat(16));
  });
  it('영숫자가 하나도 없으면 bin 폴백', () => {
    expect(sanitizeImageExt('...')).toBe('bin');
    expect(sanitizeImageExt('')).toBe('bin');
    expect(sanitizeImageExt('/\\:*?')).toBe('bin');
  });
});

describe('svgBodyHasScript — 전체 본문 검사 (256KB 갭 차단)', () => {
  it('정상 SVG → false', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
    expect(svgBodyHasScript(Buffer.from(svg))).toBe(false);
  });
  it('앞부분 <script> 차단', () => {
    const svg = '<svg><script>alert(1)</script></svg>';
    expect(svgBodyHasScript(Buffer.from(svg))).toBe(true);
  });
  it('on*= 이벤트 핸들러 차단', () => {
    const svg = '<svg><rect onload="alert(1)"/></svg>';
    expect(svgBodyHasScript(Buffer.from(svg))).toBe(true);
  });
  it('javascript: URL 차단', () => {
    const svg = '<svg><a href="javascript:alert(1)"/></svg>';
    expect(svgBodyHasScript(Buffer.from(svg))).toBe(true);
  });
  it('256KB 이후에 숨긴 <script> 도 차단 (전체 본문 검사)', () => {
    const padding = '<!-- ' + 'A'.repeat(300 * 1024) + ' -->';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg">' + padding + '<script>alert(1)</script></svg>';
    const buf = Buffer.from(svg);
    expect(buf.length).toBeGreaterThan(256 * 1024);
    expect(svgBodyHasScript(buf)).toBe(true);
  });
});
