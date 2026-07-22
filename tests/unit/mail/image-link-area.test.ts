import { describe, expect, it } from 'vitest';

import {
  IMAGE_LINK_AREA_MAX_WIDTH,
  countOversizedLinkAreaImages,
  deriveLinkCoords,
  expandImageLinkAreas,
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

describe('deriveLinkCoords', () => {
  it('상대좌표를 표시폭 기준 픽셀 coords 로 변환한다', () => {
    // H = 320 * 1300 / 1700 = 244.705…
    // x1=32, y1=round(0.5*244.705)=122, x2=round(0.6*320)=192, y2=round(0.6*244.705)=147
    const coords = deriveLinkCoords({ x: 0.1, y: 0.5, w: 0.5, h: 0.1 }, 1700, 1300, 320);
    expect(coords).toBe('32,122,192,147');
  });

  it('원본크기·표시폭·rect 크기가 0 이하이면 null', () => {
    const rect = { x: 0.1, y: 0.1, w: 0.5, h: 0.1 };
    expect(deriveLinkCoords(rect, 0, 1300, 320)).toBeNull();
    expect(deriveLinkCoords(rect, 1700, 1300, 0)).toBeNull();
    expect(deriveLinkCoords({ ...rect, w: 0 }, 1700, 1300, 320)).toBeNull();
  });
});

describe('expandImageLinkAreas', () => {
  it('data-link-coords 가진 img 에 usemap 을 붙이고 형제 map 을 생성한다', () => {
    const html = '<p><img src="https://r2/x.png" width="320" data-link-coords="32,122,192,147"></p>';
    const out = expandImageLinkAreas(html);
    expect(out).toContain('usemap="#m-link-0"');
    expect(out).toContain('<map name="m-link-0">');
    expect(out).toContain(
      '<area shape="rect" coords="32,122,192,147" href="{{invite_link}}"',
    );
    // map 은 img 바로 뒤 형제
    expect(out).toMatch(/<img[^>]*usemap="#m-link-0"[^>]*><map/);
  });

  it('이미지 여러 개면 map name 이 유일하다', () => {
    const html =
      '<img src="a.png" data-link-coords="0,0,10,10"><img src="b.png" data-link-coords="0,0,20,20">';
    const out = expandImageLinkAreas(html);
    expect(out).toContain('usemap="#m-link-0"');
    expect(out).toContain('usemap="#m-link-1"');
  });

  it('self-closing img 도 처리한다', () => {
    const out = expandImageLinkAreas('<img src="a.png" data-link-coords="0,0,10,10" />');
    expect(out).toContain('usemap="#m-link-0"');
    expect(out).toContain('<map name="m-link-0">');
  });

  it('data-link-coords 없는 img 와 빈 문자열은 그대로', () => {
    const plain = '<p><img src="a.png" width="320"></p>';
    expect(expandImageLinkAreas(plain)).toBe(plain);
    expect(expandImageLinkAreas('')).toBe('');
  });
});

describe('countOversizedLinkAreaImages', () => {
  it('px 폭이 기준 이하인 클릭 영역 이미지는 위반 아님', () => {
    const html = `<img src="a.png" width="${IMAGE_LINK_AREA_MAX_WIDTH}" data-link-rect="0.1,0.1,0.5,0.1">`;
    expect(countOversizedLinkAreaImages(html)).toBe(0);
  });

  it('기준 초과·폭 없음은 위반', () => {
    expect(
      countOversizedLinkAreaImages('<img src="a.png" width="400" data-link-rect="0,0,1,1">'),
    ).toBe(1);
    expect(
      countOversizedLinkAreaImages('<img src="a.png" data-link-rect="0,0,1,1">'),
    ).toBe(1);
  });

  it('클릭 영역 없는 img 는 폭과 무관하게 위반 아님', () => {
    expect(countOversizedLinkAreaImages('<img src="a.png" width="900">')).toBe(0);
    expect(countOversizedLinkAreaImages('')).toBe(0);
  });

  it('data-width 는 width 로 오인식하지 않는다', () => {
    const html =
      '<img src="a.png" width="320" data-width="900" data-link-rect="0,0,1,1">';
    expect(countOversizedLinkAreaImages(html)).toBe(0);
  });
});
