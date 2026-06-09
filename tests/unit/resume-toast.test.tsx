import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResumeToast } from '@/components/survey-response/resume-toast';

// 회복 토스트의 자동 dismiss 타이머가 "메시지 set 시점"이 아니라
// "토스트가 마운트(=메인 콘텐츠 렌더)되는 시점"부터 흐르는지 검증한다.
// (pre-existing 버그: dismiss 가 use-session-recovery 의 resumeMessage set 시점에 시작돼,
//  로딩/확인중 early-return 으로 토스트가 가려진 동안 4초가 소진되어 안 보였다.)
describe('ResumeToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    cleanup();
  });

  it('전달된 메시지를 렌더한다', () => {
    render(<ResumeToast message="이전 응답을 이어서 진행합니다" onDismiss={() => {}} />);
    expect(screen.getByText('이전 응답을 이어서 진행합니다')).toBeInTheDocument();
  });

  it('마운트 후 4초가 지나기 전에는 onDismiss 를 호출하지 않는다', () => {
    const onDismiss = vi.fn();
    render(<ResumeToast message="msg" onDismiss={onDismiss} />);
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('마운트 후 4초가 지나면 onDismiss 를 정확히 1회 호출한다', () => {
    const onDismiss = vi.fn();
    render(<ResumeToast message="msg" onDismiss={onDismiss} />);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('4초 경과 전 언마운트되면 타이머를 정리해 onDismiss 를 호출하지 않는다', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<ResumeToast message="msg" onDismiss={onDismiss} />);
    unmount();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
