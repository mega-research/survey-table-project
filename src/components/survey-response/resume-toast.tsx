'use client';

import { useEffect } from 'react';

interface ResumeToastProps {
  message: string;
  onDismiss: () => void;
}

/**
 * 응답 회복 안내 토스트.
 *
 * 자동 dismiss 4초 타이머를 "resumeMessage 가 set 되는 시점"이 아니라
 * 이 컴포넌트의 마운트 시점(= 메인 콘텐츠가 실제로 렌더되는 시점)부터 흐르게 한다.
 *
 * 배경: 세션 회복은 로딩/중복확인 early-return 화면 뒤에서 일어나며 resumeMessage 를 set 한다.
 * 과거에는 dismiss 타이머가 use-session-recovery 의 set 시점부터 흘러, 마스킹 화면이 떠 있는
 * 동안 4초가 소진되어 메인 콘텐츠가 보일 때쯤엔 이미 토스트가 사라져 있었다.
 * 토스트를 자체 마운트 기준으로 dismiss 하면 메인 콘텐츠가 보이는 순간부터 온전히 4초간 노출된다.
 */
export function ResumeToast({ message, onDismiss }: ResumeToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
    // 마운트 시 1회만 타이머 설정. onDismiss 는 안정 참조(useCallback)라 deps 에서 의도적으로 제외 —
    // 매 렌더마다 타이머가 재시작되지 않도록 한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="status"
      className="mb-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700"
    >
      {message}
    </div>
  );
}
