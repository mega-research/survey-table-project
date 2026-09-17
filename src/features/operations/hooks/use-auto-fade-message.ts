'use client';

import { useEffect, useState } from 'react';

/**
 * 일정 시간 후 자동으로 비워지는 status 메시지 state.
 *
 * 컨택 단건 편집 / 회차 추가·삭제 등 액션 후 "저장 완료" 같은 토스트 표시를
 * 단일 hook 으로 통일. 별도 toast 라이브러리 없이 inline banner 로 충분한
 * 짧은 피드백에 사용.
 *
 * 사용 예:
 *   const [message, setMessage] = useAutoFadeMessage();
 *   ...
 *   setMessage('저장 완료');  // 2초 후 자동 null
 */
export function useAutoFadeMessage(durationMs = 2000) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), durationMs);
    return () => clearTimeout(t);
  }, [message, durationMs]);

  return [message, setMessage] as const;
}
