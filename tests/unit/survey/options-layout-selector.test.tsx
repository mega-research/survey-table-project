import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { OptionsLayoutSelector } from '@/components/survey-builder/options-layout-selector';

describe('OptionsLayoutSelector 모바일 배치', () => {
  it('onMobileChange 미전달 시 모바일 select 를 렌더하지 않는다', () => {
    render(<OptionsLayoutSelector value={1} onChange={() => {}} />);
    expect(screen.queryByLabelText('모바일 배치')).not.toBeInTheDocument();
  });

  it('mobileValue 미지정이면 자동이 선택돼 있다', () => {
    render(
      <OptionsLayoutSelector value={1} onChange={() => {}} mobileValue={undefined} onMobileChange={() => {}} />,
    );
    expect(screen.getByLabelText('모바일 배치')).toHaveValue('auto');
  });

  it('자동 선택 시 null, N열 선택 시 숫자를 전달한다', async () => {
    const onMobileChange = vi.fn();
    const user = userEvent.setup();
    render(
      <OptionsLayoutSelector value={1} onChange={() => {}} mobileValue={2} onMobileChange={onMobileChange} />,
    );
    const select = screen.getByLabelText('모바일 배치');
    await user.selectOptions(select, 'auto');
    expect(onMobileChange).toHaveBeenLastCalledWith(null);
    await user.selectOptions(select, '6');
    expect(onMobileChange).toHaveBeenLastCalledWith(6);
    await user.selectOptions(select, '0');
    expect(onMobileChange).toHaveBeenLastCalledWith(0);
  });
});
