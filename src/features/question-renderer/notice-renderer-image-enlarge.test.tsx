import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { NoticeRenderer } from '@/features/question-renderer/notice-renderer';

import {
  loadImageWithSize,
  settleImageEnlargeHistory,
  stubMatchMedia,
} from '../../../tests/helpers/image-size';

/**
 * 「이미지 크게 보기」 — 안내문 본문 이미지. 본문은 HTML 을 그대로 넣어 그리므로 이미지마다 부품을 끼울
 * 수 없다. 줄어 보이는 본문 이미지를 누르면 크게 보기가 열리고 머리 줄은 글자 없이 닫기 버튼만이다.
 * 링크가 걸린 이미지는 링크가 먼저다.
 */

let restoreMatchMedia: (() => void) | undefined;

afterEach(async () => {
  cleanup();
  restoreMatchMedia?.();
  restoreMatchMedia = undefined;
  await settleImageEnlargeHistory();
});

const TABLE_IMAGE = 'https://cdn.example.com/table.png';
const LINKED_IMAGE = 'https://cdn.example.com/banner.png';

const content = [
  `<p><img src="${TABLE_IMAGE}" alt="조사 일정표"></p>`,
  `<p><a href="https://example.com/info"><img src="${LINKED_IMAGE}" alt="안내 배너"></a></p>`,
].join('');

const shrunk = { natural: { width: 1920, height: 1400 }, rendered: { width: 600, height: 437 } };

function renderNotice() {
  restoreMatchMedia = stubMatchMedia({ mobile: false, hover: true });
  const { container } = render(<NoticeRenderer content={content} />);
  const image = (src: string) => container.querySelector(`img[src="${src}"]`) as HTMLImageElement;
  const badges = () => Array.from(container.querySelectorAll<HTMLElement>('[data-enlarge-badge]'));
  return { image, badges };
}

describe('안내문 본문 이미지 — 이미지 크게 보기', () => {
  it('줄어 보이는 본문 이미지를 누르면 크게 보기가 열리고 머리 줄에 글자가 없다', async () => {
    const { image } = renderNotice();
    loadImageWithSize(image(TABLE_IMAGE), shrunk);

    fireEvent.click(screen.getByRole('button', { name: '조사 일정표 크게 보기' }));

    const dialog = await screen.findByRole('dialog', { name: '이미지 크게 보기' });
    expect(within(dialog).queryByText('조사 일정표')).toBeNull();
    expect(within(dialog).getByRole('button', { name: '닫기' })).toBeInTheDocument();
  });

  it('Enter 로도 열린다', async () => {
    const { image } = renderNotice();
    loadImageWithSize(image(TABLE_IMAGE), shrunk);

    fireEvent.keyDown(screen.getByRole('button', { name: '조사 일정표 크게 보기' }), {
      key: 'Enter',
    });

    expect(await screen.findByRole('dialog', { name: '이미지 크게 보기' })).toBeInTheDocument();
  });

  it('링크가 걸린 이미지는 줄어 보여도 크게 보기가 붙지 않는다', () => {
    const { image } = renderNotice();
    loadImageWithSize(image(LINKED_IMAGE), shrunk);

    expect(screen.queryByRole('button', { name: '안내 배너 크게 보기' })).toBeNull();
    expect(image(LINKED_IMAGE)).not.toHaveAttribute('tabindex');
  });

  it('원래 크기로 다 보이는 본문 이미지는 반응하지 않는다', async () => {
    const { image } = renderNotice();
    const img = image(TABLE_IMAGE);
    loadImageWithSize(img, {
      natural: { width: 300, height: 200 },
      rendered: { width: 300, height: 200 },
    });

    expect(screen.queryByRole('button', { name: '조사 일정표 크게 보기' })).toBeNull();
    fireEvent.click(img);
    await Promise.resolve();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('줄어 보이는 본문 이미지에는 돋보기가 하나 붙고, 돋보기를 눌러도 열린다', async () => {
    const { image, badges } = renderNotice();
    loadImageWithSize(image(TABLE_IMAGE), shrunk);

    // 이미지에 이미 버튼 이름이 있으므로 돋보기는 보조 기술에 한 번 더 읽히지 않는다
    expect(badges()).toHaveLength(1);
    expect(badges()[0]).toHaveAttribute('aria-hidden', 'true');
    expect(badges()[0]).toHaveAttribute('tabindex', '-1');

    fireEvent.click(badges()[0]!);

    expect(await screen.findByRole('dialog', { name: '이미지 크게 보기' })).toBeInTheDocument();
  });

  it('링크가 걸린 이미지와 원래 크기로 다 보이는 이미지에는 돋보기가 없다', () => {
    const { image, badges } = renderNotice();
    loadImageWithSize(image(LINKED_IMAGE), shrunk);
    loadImageWithSize(image(TABLE_IMAGE), {
      natural: { width: 300, height: 200 },
      rendered: { width: 300, height: 200 },
    });

    expect(badges()).toHaveLength(0);
  });

  it('돋보기는 마우스 기기에서 숨는다 — 마우스 기기는 확대 커서와 어두워짐으로 충분하다', () => {
    const { image, badges } = renderNotice();
    loadImageWithSize(image(TABLE_IMAGE), shrunk);

    expect(badges()[0]!.className).toContain('[@media(hover:hover)]:hidden');
  });

  it('돋보기가 뜨며 다시 그려도 본문 이미지는 그대로다 — 표식이 붙은 이미지가 새 이미지로 바뀌지 않는다', () => {
    const { image } = renderNotice();
    const before = image(TABLE_IMAGE);
    loadImageWithSize(before, shrunk);

    expect(image(TABLE_IMAGE)).toBe(before);
    expect(before).toHaveAttribute('data-enlargeable');
  });
});
