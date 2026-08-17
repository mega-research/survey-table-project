'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

interface PagerJumpProps {
  totalPages: number;
  /** 클라이언트 상태 기반 페이저: 콜백으로 이동 */
  onJump?: (page: number) => void;
  /** 링크(URL) 기반 페이저: '__PAGE__' 토큰을 페이지 번호로 치환해 router.push */
  hrefTemplate?: string;
}

/**
 * 페이지 번호 직접 입력 점프. form 중첩을 피하기 위해 Enter 키 + 버튼 클릭으로 동작.
 * 범위 밖(1~totalPages) 입력은 무시한다.
 */
export function PagerJump({ totalPages, onJump, hrefTemplate }: PagerJumpProps) {
  const router = useRouter();
  const [value, setValue] = useState('');

  const jump = () => {
    const page = Number(value);
    if (!Number.isInteger(page) || page < 1 || page > totalPages) return;
    if (onJump) {
      onJump(page);
    } else if (hrefTemplate) {
      router.push(hrefTemplate.replace('__PAGE__', String(page)));
    }
    setValue('');
  };

  return (
    <div className="ml-1 flex items-center gap-1">
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            jump();
          }
        }}
        placeholder="페이지"
        aria-label="이동할 페이지 번호"
        className="w-14 rounded border border-slate-200 px-2 py-1 text-center text-xs tabular-nums placeholder:text-slate-300 focus:border-blue-400 focus:outline-none"
      />
      <button
        type="button"
        onClick={jump}
        disabled={value === ''}
        className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        이동
      </button>
    </div>
  );
}
