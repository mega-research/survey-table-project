import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { NoticeRenderer } from '@/features/question-renderer/notice-renderer';

import {
  loadImageWithSize,
  settleImageEnlargeHistory,
  stubMatchMedia,
} from '../../../tests/helpers/image-size';

/**
 * 본문 이미지 돋보기 자리 — 사진이 혼자 놓인 블록(문단·표 칸)의 오른쪽에 자리가 있을 때만 바깥에 둔다.
 * 같은 블록에 다른 이미지·글이 있거나 표 칸이 좁으면 사진 안 우상단이다. 돋보기는 본문 상자의 보이는
 * 영역으로 잘리는 층 안에 뜬다(모바일 본문은 넓은 표를 가로 스크롤한다).
 *
 * jsdom 은 배치를 계산하지 않아 사각형을 직접 정한다.
 */

let restoreMatchMedia: (() => void) | undefined;

afterEach(async () => {
  cleanup();
  restoreMatchMedia?.();
  restoreMatchMedia = undefined;
  await settleImageEnlargeHistory();
});

const shrunk = { natural: { width: 1600, height: 1200 }, rendered: { width: 100, height: 80 } };

function stubRect(el: Element, box: { left: number; top: number; right: number; bottom: number }) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () =>
      ({
        ...box,
        x: box.left,
        y: box.top,
        width: box.right - box.left,
        height: box.bottom - box.top,
      }) as DOMRect,
  });
}

function renderBody(content: string) {
  restoreMatchMedia = stubMatchMedia({ mobile: true, hover: false });
  const { container } = render(<NoticeRenderer content={content} bgColor="none" />);
  const panel = container.querySelector('[data-notice-panel]') as HTMLElement;
  stubRect(panel, { left: 0, top: 0, right: 360, bottom: 600 });
  const badgeFor = (index: number) =>
    container.querySelectorAll<HTMLElement>('[data-enlarge-badge]')[index]!;
  return { container, panel, badgeFor };
}

describe('본문 이미지 돋보기 자리', () => {
  it('문단에 혼자 놓인 사진은 문단 오른쪽에 자리가 있으면 바깥에 둔다', () => {
    const { container, badgeFor } = renderBody(
      '<p><img src="https://cdn.example.com/a.png" alt="로고"></p>',
    );
    stubRect(container.querySelector('p')!, { left: 0, top: 0, right: 360, bottom: 80 });
    const img = container.querySelector('img')!;
    stubRect(img, { left: 130, top: 0, right: 230, bottom: 80 });
    loadImageWithSize(img, shrunk);

    expect(badgeFor(0).style.left).toBe('234px');
  });

  it('한 문단에 나란히 놓인 사진은 옆 사진을 덮지 않게 사진 안에 둔다', () => {
    const { container, badgeFor } = renderBody(
      '<p><img src="https://cdn.example.com/a.png" alt="금액권"><img src="https://cdn.example.com/b.png" alt="경품"></p>',
    );
    stubRect(container.querySelector('p')!, { left: 0, top: 0, right: 360, bottom: 80 });
    const [first, second] = Array.from(container.querySelectorAll('img'));
    stubRect(first!, { left: 0, top: 0, right: 100, bottom: 80 });
    stubRect(second!, { left: 110, top: 0, right: 210, bottom: 80 });
    loadImageWithSize(first!, shrunk);
    loadImageWithSize(second!, shrunk);

    expect(badgeFor(0).style.left).toBe('66px');
  });

  it('글과 한 문단에 놓인 사진은 사진 안에 둔다', () => {
    const { container, badgeFor } = renderBody(
      '<p><img src="https://cdn.example.com/a.png" alt="로고"> 가 있는 카드</p>',
    );
    stubRect(container.querySelector('p')!, { left: 0, top: 0, right: 360, bottom: 80 });
    const img = container.querySelector('img')!;
    stubRect(img, { left: 0, top: 0, right: 100, bottom: 80 });
    loadImageWithSize(img, shrunk);

    expect(badgeFor(0).style.left).toBe('66px');
  });

  it('표 칸의 사진은 본문 끝이 아니라 그 칸 오른쪽 자리로 정한다', () => {
    const { container, badgeFor } = renderBody(
      '<table><tbody><tr><td><p><img src="https://cdn.example.com/a.png" alt="로고"></p></td><td><p>설명</p></td></tr></tbody></table>',
    );
    stubRect(container.querySelector('td')!, { left: 0, top: 0, right: 120, bottom: 80 });
    stubRect(container.querySelector('td p')!, { left: 8, top: 0, right: 112, bottom: 80 });
    const img = container.querySelector('img')!;
    stubRect(img, { left: 8, top: 0, right: 108, bottom: 80 });
    loadImageWithSize(img, shrunk);

    // 칸 안 오른쪽 자리는 4px — 다음 칸을 덮지 않도록 사진 안으로
    expect(badgeFor(0).style.left).toBe('74px');
  });

  it('돋보기는 본문 상자의 보이는 영역으로 잘리는 층 안에 뜬다', () => {
    const { container, badgeFor } = renderBody(
      '<p><img src="https://cdn.example.com/a.png" alt="로고"></p>',
    );
    loadImageWithSize(container.querySelector('img')!, shrunk);

    const layer = badgeFor(0).parentElement!;
    expect(layer).toHaveAttribute('data-enlarge-badge-layer');
    expect(layer.className).toContain('overflow-hidden');
    expect(layer.className).toContain('pointer-events-none');
    expect(badgeFor(0).className).toContain('pointer-events-auto');
  });
});
