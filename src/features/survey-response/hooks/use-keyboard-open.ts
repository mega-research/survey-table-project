import { useEffect, useState } from 'react';

/**
 * 모바일 소프트 키보드(및 iOS SELECT 네이티브 피커) 떠 있는지 감지.
 *
 * - `visualViewport` 다중 이벤트 + `window` 포커스/회전 이벤트를 병합 구독.
 * - 활성 편집 요소(INPUT/TEXTAREA/SELECT/contentEditable)가 없으면 무조건 `false` →
 *   iOS Safari에서 resize 미발화로 true에 갇히는 현상 방지.
 * - 임계값: `window.innerHeight - visualViewport.height > 150px` (경계 진동 방지용 절대값).
 *
 * SSR 안전: 마운트 전엔 `false` 반환.
 */
export function useKeyboardOpen(): boolean {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const compute = () => {
      const gap = window.innerHeight - vv.height;
      const ae = document.activeElement as HTMLElement | null;
      const isEditable =
        !!ae &&
        (ae.tagName === 'INPUT' ||
          ae.tagName === 'TEXTAREA' ||
          ae.tagName === 'SELECT' ||
          ae.isContentEditable);
      setKeyboardOpen(isEditable && gap > 150);
    };

    compute();
    vv.addEventListener('resize', compute);
    vv.addEventListener('scroll', compute);
    window.addEventListener('resize', compute);
    window.addEventListener('orientationchange', compute);
    window.addEventListener('focusin', compute);
    window.addEventListener('focusout', compute);
    document.addEventListener('visibilitychange', compute);

    return () => {
      vv.removeEventListener('resize', compute);
      vv.removeEventListener('scroll', compute);
      window.removeEventListener('resize', compute);
      window.removeEventListener('orientationchange', compute);
      window.removeEventListener('focusin', compute);
      window.removeEventListener('focusout', compute);
      document.removeEventListener('visibilitychange', compute);
    };
  }, []);

  return keyboardOpen;
}
