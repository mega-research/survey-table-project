import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { Toaster, toast } from 'sonner';
import { describe, expect, it } from 'vitest';

// jsdom 환경에서 sonner 가 window.matchMedia 를 참조하므로 스텁 주입.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

describe('toast 인프라', () => {
  it('toast.error 호출이 메시지를 렌더한다', async () => {
    render(<Toaster />);
    act(() => {
      toast.error('저장에 실패했습니다');
    });
    expect(await screen.findByText('저장에 실패했습니다')).toBeInTheDocument();
  });
});
