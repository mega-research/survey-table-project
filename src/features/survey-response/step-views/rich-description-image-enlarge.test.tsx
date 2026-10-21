import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { loadImageWithSize, stubMatchMedia } from '../../../../tests/helpers/image-size';
import { RichDescription } from './rich-description';

/** 「이미지 크게 보기」 — 문항·그룹 설명 본문 이미지도 안내문 본문과 같은 규칙으로 크게 본다 */

let restoreMatchMedia: (() => void) | undefined;

afterEach(async () => {
  cleanup();
  restoreMatchMedia?.();
  restoreMatchMedia = undefined;
  // 연 채 끝난 크게 보기는 정리 뒤 한 박자 늦게 방문 기록 칸을 걷는다 — 다음 테스트로 새지 않게 기다린다
  await new Promise((resolve) => setTimeout(resolve, 10));
});

describe('설명 본문 이미지 — 이미지 크게 보기', () => {
  it('줄어 보이는 설명 이미지를 누르면 크게 보기가 열린다', async () => {
    restoreMatchMedia = stubMatchMedia({ mobile: true, hover: false });
    const { container } = render(
      <RichDescription
        html={'<p><img src="https://cdn.example.com/map.png" alt="지역 구분도"></p>'}
      />,
    );
    loadImageWithSize(container.querySelector('img') as HTMLImageElement, {
      natural: { width: 1600, height: 1200 },
      rendered: { width: 343, height: 257 },
    });

    fireEvent.click(screen.getByRole('button', { name: '지역 구분도 크게 보기' }));

    expect(await screen.findByRole('dialog', { name: '이미지 크게 보기' })).toBeInTheDocument();
  });
});
