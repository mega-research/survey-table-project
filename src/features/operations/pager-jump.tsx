'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

import { PAGER_ITEM_CLASS } from './pager-classes';

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
        className="h-9 w-16 rounded-md border border-slate-300 bg-white px-2 text-center text-sm text-slate-800 tabular-nums placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={jump}
        disabled={value === ''}
        className={PAGER_ITEM_CLASS}
      >
        이동
      </button>
    </div>
  );
}
