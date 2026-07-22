import { describe, expect, it } from 'vitest';

import {
  buildLinkBandsAttr,
  computeBandRows,
  expandImageLinkAreas,
  parseLinkBands,
  parseLinkRect,
  parseNaturalSize,
} from '@/lib/mail/image-link-area';

describe('parseLinkRect', () => {
  it('4개 숫자 문자열을 LinkRect 로 파싱한다', () => {
    expect(parseLinkRect('0.1,0.5,0.5,0.1')).toEqual({ x: 0.1, y: 0.5, w: 0.5, h: 0.1 });
  });

  it('null/빈문자열/토큰수 불일치/NaN 은 null', () => {
    expect(parseLinkRect(null)).toBeNull();
    expect(parseLinkRect('')).toBeNull();
    expect(parseLinkRect('0.1,0.2,0.3')).toBeNull();
    expect(parseLinkRect('a,b,c,d')).toBeNull();
  });
});

describe('parseNaturalSize', () => {
  it('W,H 문자열을 파싱한다', () => {
    expect(parseNaturalSize('1700,1300')).toEqual({ width: 1700, height: 1300 });
  });

  it('0 이하·형식 불량은 null', () => {
    expect(parseNaturalSize('0,100')).toBeNull();
    expect(parseNaturalSize('1700')).toBeNull();
    expect(parseNaturalSize(undefined)).toBeNull();
  });
});

describe('computeBandRows', () => {
  it('상대 y 범위를 픽셀 밴드 경계로 변환한다', () => {
    // 1000px 높이, y=0.6376 h=0.0626 → y1=638, y2=700
    expect(computeBandRows({ x: 0, y: 0.6376, w: 1, h: 0.0626 }, 1000)).toEqual({
      y1: 638,
      y2: 700,
    });
  });

  it('경계 클램프 — 상단 끝 영역은 y1=0, 하단 끝 영역은 y2=height', () => {
    expect(computeBandRows({ x: 0, y: 0, w: 1, h: 0.3 }, 100)).toEqual({ y1: 0, y2: 30 });
    expect(computeBandRows({ x: 0, y: 0.7, w: 1, h: 0.3 }, 100)).toEqual({ y1: 70, y2: 100 });
  });

  it('아주 얇은 영역도 최소 1px 밴드를 보장한다', () => {
    const rows = computeBandRows({ x: 0, y: 0.5, w: 1, h: 0.001 }, 100);
    expect(rows).not.toBeNull();
    expect(rows!.y2 - rows!.y1).toBeGreaterThanOrEqual(1);
  });

  it('height 0 이하·h 0 이하는 null', () => {
    expect(computeBandRows({ x: 0, y: 0.5, w: 1, h: 0.1 }, 0)).toBeNull();
    expect(computeBandRows({ x: 0, y: 0.5, w: 1, h: 0 }, 100)).toBeNull();
  });
});

describe('buildLinkBandsAttr / parseLinkBands', () => {
  it('3밴드 값을 직렬화·파싱한다', () => {
    const attr = buildLinkBandsAttr('https://r2/t.png', 'https://r2/m.png', 'https://r2/b.png');
    expect(parseLinkBands(attr)).toEqual({
      top: 'https://r2/t.png',
      mid: 'https://r2/m.png',
      bottom: 'https://r2/b.png',
    });
  });

  it('top/bottom 이 없는 경우 null 로 파싱한다', () => {
    expect(parseLinkBands(buildLinkBandsAttr(null, 'https://r2/m.png', null))).toEqual({
      top: null,
      mid: 'https://r2/m.png',
      bottom: null,
    });
  });

  it('mid 누락·형식 불량은 null', () => {
    expect(parseLinkBands('a||b')).toBeNull();
    expect(parseLinkBands('only-mid')).toBeNull();
    expect(parseLinkBands(null)).toBeNull();
  });
});

describe('expandImageLinkAreas', () => {
  const bands = 'https://r2/x-top.png|https://r2/x-mid.png|https://r2/x-bottom.png';

  it('data-link-bands 가진 img 를 3행 밴드 테이블로 치환한다', () => {
    const html = `<p><img src="https://r2/x.png" style="width: 100%; height: auto;" data-link-bands="${bands}"></p>`;
    const out = expandImageLinkAreas(html);
    expect(out).toContain('<table class="mail-link-bands"');
    expect(out).toContain('width: 100%');
    expect((out.match(/<tr>/g) ?? []).length).toBe(3);
    expect(out).toContain('src="https://r2/x-top.png"');
    expect(out).toContain(
      '<a href="{{invite_link}}" target="_blank" rel="noopener noreferrer">',
    );
    expect(out).toMatch(/<a [^>]*><img src="https:\/\/r2\/x-mid\.png"/);
    expect(out).toContain('src="https://r2/x-bottom.png"');
    expect(out).not.toContain('<img src="https://r2/x.png"');
  });

  it('top/bottom 없는 밴드는 행을 생성하지 않는다', () => {
    const html = `<img src="https://r2/x.png" data-link-bands="|https://r2/x-mid.png|">`;
    const out = expandImageLinkAreas(html);
    expect((out.match(/<tr>/g) ?? []).length).toBe(1);
    expect(out).toMatch(/<a [^>]*><img src="https:\/\/r2\/x-mid\.png"/);
  });

  it('px 폭 이미지는 테이블에 px 폭을 적용한다', () => {
    const html = `<img src="https://r2/x.png" width="668" data-link-bands="${bands}">`;
    const out = expandImageLinkAreas(html);
    expect(out).toContain('style="width: 668px; max-width: 100%;');
  });

  it('폭 정보가 없으면 100% 를 기본으로 한다', () => {
    const html = `<img src="https://r2/x.png" data-link-bands="${bands}">`;
    expect(expandImageLinkAreas(html)).toContain('style="width: 100%; max-width: 100%;');
  });

  it('data-link-bands 없는 img 와 빈 문자열은 그대로', () => {
    const plain = '<p><img src="a.png" width="320" data-link-rect="0.1,0.1,0.5,0.1"></p>';
    expect(expandImageLinkAreas(plain)).toBe(plain);
    expect(expandImageLinkAreas('')).toBe('');
  });
});
