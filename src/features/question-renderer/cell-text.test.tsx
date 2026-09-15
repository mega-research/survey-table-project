import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CellText, resolveCellTextHtml } from './cell-text';

describe('CellText', () => {
  it('서식본이 있으면 평문 대신 sanitize 한 HTML 을 그린다', () => {
    const { container } = render(
      <CellText
        text="제목 강조"
        html='<p>제목 <span style="color: #ff0000">강조</span><script>x</script></p>'
      />,
    );
    const root = container.querySelector('.cell-rich-text');
    expect(root).not.toBeNull();
    expect(root!.innerHTML).toBe('<p>제목 <span style="color:#ff0000">강조</span></p>');
    expect(container.textContent).toBe('제목 강조');
  });

  it('첫 줄만 굵게는 서식본에서 첫 문단 클래스로 건다', () => {
    const { container } = render(
      <CellText text="제목\n설명" html="<p>제목</p><p><strong>설</strong>명</p>" boldFirstLine />,
    );
    expect(container.querySelector('.cell-rich-text')).toHaveClass('cell-rich-text-bold-first');
  });

  it('서식본이 없으면 평문 경로 그대로다', () => {
    const { container } = render(<CellText text={'제목\n설명'} boldFirstLine />);
    expect(container.querySelector('.cell-rich-text')).toBeNull();
    expect(container.querySelector('.font-bold')?.textContent).toBe('제목');
  });
});

describe('resolveCellTextHtml', () => {
  it('서식본의 토큰을 치환하고, 없으면 undefined', () => {
    expect(
      resolveCellTextHtml(
        { contentHtml: '<p><strong>{{{이름}}}</strong>님</p>' },
        {},
        { 이름: '홍길동' },
      ),
    ).toBe('<p><strong>홍길동</strong>님</p>');
    expect(resolveCellTextHtml({}, {}, {})).toBeUndefined();
  });
});
