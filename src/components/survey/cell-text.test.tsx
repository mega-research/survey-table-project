import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CellText } from '@/components/survey/cell-text';

describe('CellText — 첫 줄만 굵게', () => {
  const text = '1) 시스템반도체 얼라이언스 운영\n팹리스 수요-공급기업 간 협력\n행사 개최';

  it('꺼져 있으면 아무것도 감싸지 않는다', () => {
    const { container } = render(<CellText text={text} />);
    expect(container.querySelector('.font-bold')).toBeNull();
    expect(container.textContent).toBe(text);
  });

  it('첫 줄만 굵게 감싸고 나머지는 그대로 둔다', () => {
    const { container } = render(<CellText text={text} boldFirstLine />);
    const bold = container.querySelector('.font-bold');
    expect(bold?.textContent).toBe('1) 시스템반도체 얼라이언스 운영');
    // 글자는 하나도 잃지 않는다 — 줄바꿈 포함
    expect(container.textContent).toBe(text);
  });

  it('줄바꿈이 없으면 셀 전체가 제목이다', () => {
    const { container } = render(<CellText text="구분" boldFirstLine />);
    expect(container.querySelector('.font-bold')?.textContent).toBe('구분');
  });

  it('빈 문자열도 터지지 않는다', () => {
    const { container } = render(<CellText text="" boldFirstLine />);
    expect(container.textContent).toBe('');
  });

  /** 설명 줄의 `\n` 을 소비하면 호출부의 whitespace-pre-wrap 이 무력해져 한 줄로 붙는다. */
  it('둘째 줄 앞의 줄바꿈을 삼키지 않는다', () => {
    render(
      <div data-testid="wrap">
        <CellText text={'제목\n설명'} boldFirstLine />
      </div>,
    );
    expect(screen.getByTestId('wrap').textContent).toBe('제목\n설명');
  });
});
