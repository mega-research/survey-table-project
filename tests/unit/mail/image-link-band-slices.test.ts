import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureImageLinkBandSlices } from '@/lib/mail/image-link-band-slices';

const uploads: { key: string; body: Buffer; contentType: string }[] = [];

vi.mock('@/lib/image-utils-server', () => ({
  downloadR2Object: vi.fn(async () => makeTestImage()),
  uploadR2Object: vi.fn(async (key: string, body: Buffer, contentType: string) => {
    uploads.push({ key, body, contentType });
  }),
}));

vi.mock('@/lib/r2-env', () => ({
  getR2PublicUrl: () => 'https://r2.example.com',
}));

// 100x200 단색 PNG — 밴드 높이 검증용
async function makeTestImage(): Promise<Buffer> {
  return sharp({
    create: { width: 100, height: 200, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer();
}

beforeEach(() => {
  uploads.length = 0;
});

describe('ensureImageLinkBandSlices', () => {
  const imgTag =
    '<img src="https://r2.example.com/mail/a.png" style="width: 100%;" ' +
    'data-link-rect="0.1,0.5,0.5,0.25" data-link-natural="100,200">';

  it('영역 y 범위로 3밴드를 잘라 업로드하고 data-link-bands 를 주입한다', async () => {
    const out = await ensureImageLinkBandSlices(`<p>${imgTag}</p>`);

    expect(uploads).toHaveLength(3);
    const names = uploads.map((u) => u.key);
    expect(names[0]).toMatch(/^mail\/link-bands\/[0-9a-f]{16}-top\.png$/);
    expect(names[1]).toMatch(/-mid\.png$/);
    expect(names[2]).toMatch(/-bottom\.png$/);

    // H=200, y=0.5 h=0.25 → top 100px, mid 50px, bottom 50px
    const heights = await Promise.all(
      uploads.map(async (u) => (await sharp(u.body).metadata()).height),
    );
    expect(heights).toEqual([100, 50, 50]);

    expect(out).toMatch(
      /data-link-bands="https:\/\/r2\.example\.com\/mail\/link-bands\/[0-9a-f]{16}-top\.png\|[^|]+-mid\.png\|[^|]+-bottom\.png"/,
    );
  });

  it('상단 끝 영역은 top 밴드 없이 2개만 업로드한다', async () => {
    const tag =
      '<img src="https://r2.example.com/mail/a.png" data-link-rect="0,0,1,0.5">';
    const out = await ensureImageLinkBandSlices(tag);
    expect(uploads.map((u) => u.key.split('-').pop())).toEqual(['mid.png', 'bottom.png']);
    expect(out).toContain('data-link-bands="|');
  });

  it('R2 외부 이미지·rect 없는 이미지는 스킵한다', async () => {
    const external =
      '<img src="https://other.example.com/x.png" data-link-rect="0.1,0.5,0.5,0.25">';
    const noRect = '<img src="https://r2.example.com/mail/b.png">';
    const html = `${external}${noRect}`;
    expect(await ensureImageLinkBandSlices(html)).toBe(html);
    expect(uploads).toHaveLength(0);
  });

  it('data-link-rect 가 전혀 없으면 원본 그대로 (다운로드 시도 없음)', async () => {
    const html = '<p><img src="https://r2.example.com/mail/b.png"></p>';
    expect(await ensureImageLinkBandSlices(html)).toBe(html);
    expect(uploads).toHaveLength(0);
  });

  it('재저장 시 기존 data-link-bands 를 새 값으로 교체한다', async () => {
    const withStale =
      '<img src="https://r2.example.com/mail/a.png" data-link-rect="0.1,0.5,0.5,0.25" ' +
      'data-link-bands="stale|stale|stale">';
    const out = await ensureImageLinkBandSlices(withStale);
    expect(out).not.toContain('stale');
    expect((out.match(/data-link-bands=/g) ?? []).length).toBe(1);
  });
});
