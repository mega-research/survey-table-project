import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MobileTableDisplaySettings } from '@/components/survey-builder/mobile-table-display-settings';

describe('MobileTableDisplaySettings', () => {
  it('새 모드에서만 제외 열 수 입력을 보여준다', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MobileTableDisplaySettings
        mode="auto"
        omitLeadingColumns={1}
        columnCount={11}
        repeatHeaderStartRow={0}
        repeatHeaderEndRow={0}
        onChange={onChange}
      />,
    );

    expect(screen.queryByLabelText('상세에서 제외할 앞쪽 열 수')).toBeNull();

    rerender(
      <MobileTableDisplaySettings
        mode="drilldown-original-row"
        omitLeadingColumns={1}
        columnCount={11}
        repeatHeaderStartRow={0}
        repeatHeaderEndRow={0}
        onChange={onChange}
      />,
    );

    expect(screen.getByLabelText('상세에서 제외할 앞쪽 열 수')).toHaveAttribute('max', '10');
  });

  it('모드와 clamp된 숫자를 부모로 전달한다', () => {
    const onChange = vi.fn();
    render(
      <MobileTableDisplaySettings
        mode="auto"
        omitLeadingColumns={1}
        columnCount={3}
        repeatHeaderStartRow={0}
        repeatHeaderEndRow={0}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: '드릴다운 후 선택 행 원본' }));

    expect(onChange).toHaveBeenCalledWith({
      mode: 'drilldown-original-row',
      omitLeadingColumns: 1,
      repeatHeaderStartRow: 0,
      repeatHeaderEndRow: 0,
    });
  });

  it('제외 열 수를 작성한 열 범위로 clamp하여 전달한다', () => {
    const onChange = vi.fn();
    render(
      <MobileTableDisplaySettings
        mode="drilldown-original-row"
        omitLeadingColumns={1}
        columnCount={3}
        repeatHeaderStartRow={0}
        repeatHeaderEndRow={0}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('상세에서 제외할 앞쪽 열 수'), { target: { value: '9' } });

    expect(onChange).toHaveBeenCalledWith({
      mode: 'drilldown-original-row',
      omitLeadingColumns: 2,
      repeatHeaderStartRow: 0,
      repeatHeaderEndRow: 0,
    });
  });

  it('라벨된 radiogroup과 세 radio 및 비색상 선택 표시를 제공한다', () => {
    render(
      <MobileTableDisplaySettings
        mode="auto"
        omitLeadingColumns={1}
        columnCount={3}
        repeatHeaderStartRow={0}
        repeatHeaderEndRow={0}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('radiogroup', { name: '모바일 표시 방식' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: '자동 카드' })).toBeChecked();
    expect(screen.getByText('선택됨')).toBeInTheDocument();
  });

  it('드릴다운 모드에서만 반복 헤더 입력과 도움말을 보여준다', () => {
    const props = {
      omitLeadingColumns: 1,
      columnCount: 5,
      repeatHeaderStartRow: 0,
      repeatHeaderEndRow: 2,
      onChange: vi.fn(),
    };
    const { rerender } = render(<MobileTableDisplaySettings mode="auto" {...props} />);
    expect(screen.queryByLabelText('상세에서 반복할 헤더 행')).toBeNull();
    rerender(<MobileTableDisplaySettings mode="drilldown-original-row" {...props} />);
    expect(screen.getByLabelText('상세에서 반복할 헤더 행')).toHaveValue('0-2');
    expect(screen.getByText('비우면 반복하지 않습니다. 0은 진짜 헤더이며, 3 또는 0-2처럼 입력합니다.'))
      .toBeInTheDocument();
  });

  it('Enter와 blur에서 정상 범위를 start/end로 확정한다', () => {
    const onChange = vi.fn();
    render(
      <MobileTableDisplaySettings
        mode="drilldown-original-row"
        omitLeadingColumns={1}
        columnCount={5}
        repeatHeaderStartRow={0}
        repeatHeaderEndRow={0}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText('상세에서 반복할 헤더 행');
    fireEvent.change(input, { target: { value: '2-3' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith({
      mode: 'drilldown-original-row',
      omitLeadingColumns: 1,
      repeatHeaderStartRow: 2,
      repeatHeaderEndRow: 3,
    });
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith({
      mode: 'drilldown-original-row',
      omitLeadingColumns: 1,
      repeatHeaderStartRow: null,
      repeatHeaderEndRow: null,
    });
  });

  it('잘못된 transient 입력은 직전 정상값으로 되돌린다', () => {
    render(
      <MobileTableDisplaySettings
        mode="drilldown-original-row"
        omitLeadingColumns={1}
        columnCount={5}
        repeatHeaderStartRow={2}
        repeatHeaderEndRow={3}
        onChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('상세에서 반복할 헤더 행');
    fireEvent.change(input, { target: { value: '3-2' } });
    fireEvent.blur(input);
    expect(input).toHaveValue('2-3');
  });

  it('다른 모바일 모드로 바꿀 때 명시적 null/null을 보존한다', () => {
    const onChange = vi.fn();
    render(
      <MobileTableDisplaySettings
        mode="drilldown-original-row"
        omitLeadingColumns={1}
        columnCount={5}
        repeatHeaderStartRow={null}
        repeatHeaderEndRow={null}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: '전체 원본 표' }));
    expect(onChange).toHaveBeenLastCalledWith({
      mode: 'original',
      omitLeadingColumns: 1,
      repeatHeaderStartRow: null,
      repeatHeaderEndRow: null,
    });
  });
});
