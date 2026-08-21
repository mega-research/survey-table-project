import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CellStyleFields } from '@/components/survey-builder/table-editor/cell-style-fields';

describe('CellStyleFields', () => {
  it('Bold를 토글하고 유효한 HEX만 canonical 값으로 전달한다', async () => {
    const user = userEvent.setup();
    const onBold = vi.fn();
    const onBackground = vi.fn();
    render(
      <CellStyleFields
        textBold={false}
        backgroundColor=""
        textColor=""
        onTextBoldChange={onBold}
        onBackgroundColorChange={onBackground}
        onTextColorChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('switch', { name: '텍스트 굵게' }));
    expect(onBold).toHaveBeenCalledWith(true);

    await user.type(screen.getByLabelText('배경색 HEX'), 'abc');
    await user.tab();
    expect(onBackground).toHaveBeenCalledWith('#AABBCC');
  });

  it('잘못된 HEX는 기존 색을 바꾸지 않고 초기화 버튼은 색을 제거한다', async () => {
    const user = userEvent.setup();
    const onBackground = vi.fn();
    render(
      <CellStyleFields
        textBold={false}
        backgroundColor="#112233"
        textColor=""
        onTextBoldChange={() => {}}
        onBackgroundColorChange={onBackground}
        onTextColorChange={vi.fn()}
      />,
    );

    await user.clear(screen.getByLabelText('배경색 HEX'));
    await user.type(screen.getByLabelText('배경색 HEX'), 'ZZZ');
    await user.tab();
    expect(onBackground).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '배경색 없음' }));
    expect(onBackground).toHaveBeenCalledWith('');
  });

  it('HEX 입력을 비우고 blur하면 오류 없이 배경색 제거를 전달한다', async () => {
    const user = userEvent.setup();
    const onBackground = vi.fn();
    const onInvalidColor = vi.fn();
    render(
      <CellStyleFields
        textBold={false}
        backgroundColor="#112233"
        textColor=""
        onTextBoldChange={() => {}}
        onBackgroundColorChange={onBackground}
        onTextColorChange={vi.fn()}
        onInvalidColor={onInvalidColor}
      />,
    );

    await user.clear(screen.getByLabelText('배경색 HEX'));
    await user.tab();

    expect(onBackground).toHaveBeenCalledWith('');
    expect(onInvalidColor).not.toHaveBeenCalled();
  });
});
