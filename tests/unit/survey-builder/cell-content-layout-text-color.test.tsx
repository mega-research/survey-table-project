import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CellContentLayout } from '@/components/question-renderer/cells/cell-content-layout';

/**
 * 라벨 div 에는 DEFAULT_LABEL_CLASS 의 text-gray-700 이 이미 붙어 있다.
 * 조상 컨테이너에 color 를 주는 방식으로는 이 클래스를 이기지 못하므로
 * 라벨 자신에게 inline style 이 얹혀야 한다. 이 테스트가 그 계약을 잠근다.
 */
describe('CellContentLayout 글자색', () => {
  it('textColor 를 라벨 요소에 inline style 로 얹는다', () => {
    render(
      <CellContentLayout content="문항 라벨" textColor="#FFFFFF">
        <input aria-label="입력" />
      </CellContentLayout>,
    );

    expect(screen.getByText('문항 라벨')).toHaveStyle({ color: '#FFFFFF' });
  });

  it('textColor 가 없으면 style 을 만들지 않아 기존 클래스 색이 유지된다', () => {
    render(
      <CellContentLayout content="문항 라벨">
        <input aria-label="입력" />
      </CellContentLayout>,
    );

    expect(screen.getByText('문항 라벨').getAttribute('style')).toBeNull();
  });

  it('텍스트 위치를 바꿔도 글자색이 유지된다', () => {
    render(
      <CellContentLayout content="문항 라벨" position="left" textColor="#FF0000">
        <input aria-label="입력" />
      </CellContentLayout>,
    );

    expect(screen.getByText('문항 라벨')).toHaveStyle({ color: '#FF0000' });
  });
});
