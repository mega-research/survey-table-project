import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlaceholderField } from './placeholder-field';

describe('PlaceholderField', () => {
  it('여러 줄 응답 칸이면 줄바꿈을 칠 수 있는 여러 줄 입력칸으로 그린다', () => {
    const onChange = vi.fn();
    render(<PlaceholderField id="placeholder" value="" onChange={onChange} multiline />);

    const field = screen.getByRole('textbox');
    expect(field.tagName).toBe('TEXTAREA');

    fireEvent.change(field, { target: { value: 'ex1. 대학 재학 중\nex2. 진로 고민' } });
    expect(onChange).toHaveBeenCalledWith('ex1. 대학 재학 중\nex2. 진로 고민');
  });

  it('저장된 줄바꿈을 그대로 보여 주고 줄 수만큼 높이를 잡는다', () => {
    render(
      <PlaceholderField id="placeholder" value={'첫 줄\n둘째 줄\n셋째 줄'} onChange={() => {}} multiline />,
    );

    const field = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(field.value).toBe('첫 줄\n둘째 줄\n셋째 줄');
    expect(field.rows).toBe(3);
  });

  it('한 줄 응답 칸이면 한 줄 입력칸으로 둔다 — 브라우저가 한 줄 칸의 안내 문구 줄바꿈을 버린다', () => {
    render(<PlaceholderField id="placeholder" value="" onChange={() => {}} multiline={false} />);

    expect(screen.getByRole('textbox').tagName).toBe('INPUT');
  });
});
