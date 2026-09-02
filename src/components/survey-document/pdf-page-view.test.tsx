import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { fitPageWidth, PdfPageView } from './pdf-page-view';

// pdf.js 는 jsdom 에서 열리지 않는다. 이 파일이 재는 것은 좌표계를 만드는 마크업이지
// 렌더 결과가 아니므로, 문서 열기는 실패한 채로 두고 셸만 본다.
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: () => ({ promise: Promise.reject(new Error('jsdom')) }),
}));

/**
 * 쪽을 감싼 상자의 클래스는 **좌표계 그 자체다.**
 *
 * - `relative` 가 빠지면 실측 원점(offsetParent)이 스크롤 상자로 옮겨가 `onPageBox` 가
 *   0/0 이 아닌 값을 올려보낸다.
 * - `mx-auto w-fit` 이 빠지면 상자가 전폭이 되어 왼쪽 끝이 쪽의 왼쪽 끝과 달라지고,
 *   드래그가 원점을 그 상자에서 재므로 사각형이 커서에서 멀어진다.
 *
 * 2026-08-31 에 실제로 그렇게 깨졌다 — `surfaceProps` 를 통째로 펼치면서 JSX 의
 * "뒤에 온 prop 이 이긴다" 규칙에 클래스가 통째로 덮였다. 화면은 그려지므로
 * 타입도 린트도 잡지 못하고 드래그 좌표만 조용히 어긋났다.
 */
function surfaceOf(container: HTMLElement): HTMLElement {
  const scroller = container.querySelector<HTMLElement>('.overflow-auto');
  const surface = scroller?.firstElementChild;
  if (!(surface instanceof HTMLElement)) throw new Error('감싼 상자를 찾지 못했습니다');
  return surface;
}

const base = { url: 'https://example.test/a.pdf', pageCount: 3, page: 1, onPageChange: () => {} };

describe('PdfPageView — 쪽을 감싼 상자', () => {
  it('좌표계를 만드는 클래스를 갖는다', () => {
    const { container } = render(<PdfPageView {...base} />);
    const surface = surfaceOf(container);
    expect(surface.className).toContain('relative');
    expect(surface.className).toContain('mx-auto');
    expect(surface.className).toContain('w-fit');
  });

  it('surfaceProps 의 className 이 레이아웃 클래스를 덮지 않는다', () => {
    const { container } = render(
      <PdfPageView {...base} surfaceProps={{ className: 'cursor-crosshair select-none' }} />,
    );
    const surface = surfaceOf(container);
    expect(surface.className).toContain('relative');
    expect(surface.className).toContain('mx-auto');
    expect(surface.className).toContain('w-fit');
    expect(surface.className).toContain('cursor-crosshair');
  });

  it('className 이 undefined 로 넘어와도 레이아웃 클래스가 남는다', () => {
    // 지정 모드가 꺼진 상태 — 명시된 undefined 도 JSX 에서는 덮어쓰기다
    const { container } = render(
      <PdfPageView {...base} surfaceProps={{ className: undefined }} />,
    );
    expect(surfaceOf(container).className).toContain('relative');
  });

  it('surfaceProps 의 마우스 핸들러는 그 상자에 붙는다', () => {
    const onMouseDown = vi.fn();
    const { container } = render(<PdfPageView {...base} surfaceProps={{ onMouseDown }} />);
    surfaceOf(container).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onMouseDown).toHaveBeenCalled();
  });

  it('overlay 는 그 상자 안에 놓인다 — 드래그와 같은 원점이어야 한다', () => {
    const { container } = render(
      <PdfPageView {...base} overlay={<div data-testid="ov" />} />,
    );
    const overlay = container.querySelector('[data-testid="ov"]');
    expect(overlay?.parentElement).toBe(surfaceOf(container));
  });
});

describe('fitPageWidth', () => {
  const PAD = 24;

  it('배율 100% 에서는 판 안쪽 폭을 넘지 않는다', () => {
    // 가로 스크롤바가 생기느냐 마느냐가 이 한 줄에 걸려 있다.
    for (const paneWidth of [900, 901, 1024, 1279, 1440]) {
      const availWidth = paneWidth - PAD * 2;
      const { cssWidth } = fitPageWidth({ baseWidth: 595.276, availWidth, zoom: 1 });
      expect(cssWidth).toBeLessThanOrEqual(availWidth);
    }
  });

  it('부동소수점 오차로도 넘기지 않는다 — 내림한 정수를 쓴다', () => {
    // base * (avail/base) 는 avail 보다 아주 조금 클 수 있고, 그 0.0000001px 이
    // 그대로 스크롤바가 된다.
    const availWidth = 787;
    const { scale, cssWidth } = fitPageWidth({ baseWidth: 595.276, availWidth, zoom: 1 });
    expect(595.276 * scale).toBeGreaterThanOrEqual(cssWidth);
    expect(cssWidth).toBe(availWidth);
    expect(Number.isInteger(cssWidth)).toBe(true);
  });

  it('배율을 올리면 판보다 넓어진다 — 그때의 가로 스크롤은 의도된 것이다', () => {
    const { cssWidth } = fitPageWidth({ baseWidth: 595.276, availWidth: 800, zoom: 1.5 });
    expect(cssWidth).toBeGreaterThan(800);
  });

  it('판이 아주 좁으면 더 줄이지 않는다 — 읽을 수 있는 크기가 먼저다', () => {
    const { cssWidth } = fitPageWidth({ baseWidth: 595.276, availWidth: 120, zoom: 1 });
    expect(cssWidth).toBe(320);
  });
});
