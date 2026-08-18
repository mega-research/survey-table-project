import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SortIndicator } from '@/components/operations/table-primitives';

describe('SortIndicator', () => {
  it('비활성(direction=false)일 때는 아무것도 렌더하지 않는다 — 공간 예약 금지', () => {
    const { container } = render(<SortIndicator direction={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('활성일 때만 방향 화살표를 렌더한다', () => {
    const asc = render(<SortIndicator direction="asc" />);
    expect(asc.container.textContent).toBe('▲');
    const desc = render(<SortIndicator direction="desc" />);
    expect(desc.container.textContent).toBe('▼');
  });
});
