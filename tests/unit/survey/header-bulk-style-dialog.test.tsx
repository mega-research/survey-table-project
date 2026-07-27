import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { HeaderBulkStyleDialog } from '@/components/survey-builder/header-bulk-style-dialog';

describe('HeaderBulkStyleDialog', () => {
  it('Bold와 직접 입력한 3자리 HEX를 정규화해 적용한다', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <HeaderBulkStyleDialog
        open
        onOpenChange={vi.fn()}
        initialStyle={{ textBold: false, backgroundColor: '' }}
        onApply={onApply}
      />,
    );

    await user.click(screen.getByRole('switch', { name: '텍스트 굵게' }));
    await user.type(screen.getByRole('textbox', { name: 'HEX 색상' }), 'abc');

    const preview = screen.getByTestId('header-style-preview');
    expect(preview).toHaveClass('font-bold');
    expect(preview).toHaveStyle({ backgroundColor: '#AABBCC' });

    await user.click(screen.getByRole('button', { name: '전체 헤더에 적용' }));

    expect(onApply).toHaveBeenCalledWith({
      textBold: true,
      backgroundColor: '#AABBCC',
    });
  });

  it('잘못된 HEX는 오류를 표시하고 적용하지 않는다', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <HeaderBulkStyleDialog
        open
        onOpenChange={vi.fn()}
        initialStyle={{ textBold: false, backgroundColor: '' }}
        onApply={onApply}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: 'HEX 색상' }), '12ZZ99');
    await user.click(screen.getByRole('button', { name: '전체 헤더에 적용' }));

    expect(screen.getByRole('alert')).toHaveTextContent('3자리 또는 6자리 HEX 색상을 입력하세요.');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('동일한 초기 스타일 객체로 재렌더해도 작성 중인 값과 오류를 보존한다', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const { rerender } = render(
      <HeaderBulkStyleDialog
        open
        onOpenChange={vi.fn()}
        initialStyle={{ textBold: false, backgroundColor: '' }}
        onApply={onApply}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: 'HEX 색상' }), '12ZZ99');
    await user.click(screen.getByRole('button', { name: '전체 헤더에 적용' }));

    rerender(
      <HeaderBulkStyleDialog
        open
        onOpenChange={vi.fn()}
        initialStyle={{ textBold: false, backgroundColor: '' }}
        onApply={onApply}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'HEX 색상' })).toHaveValue('12ZZ99');
    expect(screen.getByRole('alert')).toHaveTextContent('3자리 또는 6자리 HEX 색상을 입력하세요.');
  });

  it('배경색 없음과 Bold 해제를 빈 스타일로 적용한다', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <HeaderBulkStyleDialog
        open
        onOpenChange={vi.fn()}
        initialStyle={{ textBold: true, backgroundColor: '#112233' }}
        onApply={onApply}
      />,
    );

    await user.click(screen.getByRole('switch', { name: '텍스트 굵게' }));
    await user.click(screen.getByRole('button', { name: '배경색 없음' }));
    await user.click(screen.getByRole('button', { name: '전체 헤더에 적용' }));

    expect(onApply).toHaveBeenCalledWith({ textBold: false, backgroundColor: '' });
  });
});
