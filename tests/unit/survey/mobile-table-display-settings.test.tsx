import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MobileTableDisplaySettings } from '@/components/survey-builder/mobile-table-display-settings';

describe('MobileTableDisplaySettings', () => {
  it('새 모드에서만 제외 열 수 입력을 보여준다', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MobileTableDisplaySettings mode="auto" omitLeadingColumns={1} columnCount={11} onChange={onChange} />,
    );

    expect(screen.queryByLabelText('상세에서 제외할 앞쪽 열 수')).toBeNull();

    rerender(
      <MobileTableDisplaySettings
        mode="drilldown-original-row"
        omitLeadingColumns={1}
        columnCount={11}
        onChange={onChange}
      />,
    );

    expect(screen.getByLabelText('상세에서 제외할 앞쪽 열 수')).toHaveAttribute('max', '10');
  });

  it('모드와 clamp된 숫자를 부모로 전달한다', () => {
    const onChange = vi.fn();
    render(
      <MobileTableDisplaySettings mode="auto" omitLeadingColumns={1} columnCount={3} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole('button', { name: '드릴다운 후 선택 행 원본' }));

    expect(onChange).toHaveBeenCalledWith({ mode: 'drilldown-original-row', omitLeadingColumns: 1 });
  });

  it('제외 열 수를 작성한 열 범위로 clamp하여 전달한다', () => {
    const onChange = vi.fn();
    render(
      <MobileTableDisplaySettings
        mode="drilldown-original-row"
        omitLeadingColumns={1}
        columnCount={3}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('상세에서 제외할 앞쪽 열 수'), { target: { value: '9' } });

    expect(onChange).toHaveBeenCalledWith({ mode: 'drilldown-original-row', omitLeadingColumns: 2 });
  });
});
