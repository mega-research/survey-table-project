import { type RefObject, useLayoutEffect } from 'react';

/**
 * textarea 높이를 내용에 맞춘다. `rows` 가 최소 높이다 — 높이를 비운 뒤 재면
 * 브라우저가 rows 기준 높이를 돌려주므로 글이 짧으면 그 아래로 줄지 않는다.
 *
 * 값이 바뀔 때와 칸 폭이 바뀔 때(표 열 너비·화면 회전으로 줄바꿈 위치가 달라짐) 다시 잰다.
 * 스크롤에는 반응하지 않는다 — 스크롤 중 스타일을 쓰면 화면이 뒤따라 흔들린다.
 */
export function useAutoGrowTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  enabled: boolean,
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;

    let lastWidth = -1;
    const fit = () => {
      el.style.height = 'auto';
      const style = getComputedStyle(el);
      // scrollHeight 는 테두리를 뺀 값이고 칸은 border-box 라 테두리를 더한다
      const border =
        (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
      el.style.height = `${el.scrollHeight + border}px`;
    };
    fit();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      // 높이 변경은 fit 이 만든 것이라 폭이 바뀐 경우만 다시 잰다(무한 반복 방지)
      if (width === lastWidth) return;
      lastWidth = width;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, value, enabled]);
}
