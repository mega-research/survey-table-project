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

/**
 * 셀 텍스트를 그리는 자리가 여럿인데 한 곳만 빠뜨리면 같은 셀이 화면마다 다르게 보인다.
 * 실제로 PreviewCell 의 text 폴백이 CellText 를 안 타서, 보기-소스 표에서는
 * 「첫 줄만 굵게」가 통째로 무시됐다(2026-09-10).
 */
describe('셀 텍스트 렌더 경로', () => {
  it('PreviewCell 의 text 폴백이 CellText 를 탄다', async () => {
    const { PreviewCell } = await import('@/components/survey-builder/cells/preview-cell');
    const cell = {
      id: 'c1',
      type: 'text',
      content: '제목 줄\n설명 줄',
      boldFirstLine: true,
    } as never;
    const { container } = render(<PreviewCell cell={cell} />);
    expect(container.querySelector('.font-bold')?.textContent).toBe('제목 줄');
    expect(container.textContent).toBe('제목 줄\n설명 줄');
  });
});
