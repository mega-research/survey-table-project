'use client';

import type { CSSProperties, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** OptionTextRow 안에 넣는 맨몸 input 공통 클래스 (베이스 Input 스타일 없이 셸이 박스 담당) */
export const OPTION_TEXT_BARE_INPUT_CLS =
  'h-8 min-w-0 flex-1 appearance-none rounded-md border-0 bg-transparent pr-2 text-sm text-gray-900 shadow-none outline-none placeholder:text-gray-400';

interface OptionTextRowProps {
  /** 라벨 칩 문구 (토큰 치환 완료본) */
  label: string;
  /** 테이블 셀 등 좁은 컨텍스트용 축소 스타일 */
  compact?: boolean | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  /** 맨몸 input (OPTION_TEXT_BARE_INPUT_CLS 적용 권장) */
  children: ReactNode;
}

/**
 * 상세 기재 입력란의 비주얼 셸 (기타 입력란 프로토타입 1d).
 * [옵션 라벨 칩 | 풀폭 입력란] 한 줄 — 보이는 박스는 이 셸 하나뿐이고, 내부 input 은
 * 맨몸으로 렌더해 이중 보더를 차단한다. label 래핑이라 칩 클릭에도 입력이 포커스된다.
 * rounded-[10px]: UA 포커스 링(입력란 6px 모서리 + 바깥쪽 ~3px 두께 ≈ 외경 9px)과
 * 바깥 보더가 거의 동심원으로 맞물리는 값. 링 자체는 브라우저가 그려 CSS 제어 불가.
 */
export function OptionTextRow({ label, compact, className, style, children }: OptionTextRowProps) {
  return (
    // w-full min-w-0: 표 셀처럼 좁고 고정된 컨테이너 안에서 행이 셀 폭을 넘지 않게
    // 부모 폭에 맞춘다 — 넘치는 몫은 아래 라벨 칩이 truncate 로 흡수한다.
    <label
      style={style}
      className={cn(
        // items-center: 한 줄일 때 칩과 입력이 나란하다. 숫자 모드의 환산 안내로 두 줄이
        // 되어도 칩이 블록 가운데에 오므로 따로 정렬을 두지 않는다.
        'flex min-h-10 w-full min-w-0 cursor-text items-center gap-2 rounded-[10px] border border-gray-200 bg-white py-0.5 pr-0.5 pl-1 transition-colors hover:border-gray-300 focus-within:border-blue-400 focus-within:hover:border-blue-400',
        compact && 'min-h-8 gap-1.5',
        className,
      )}
    >
      {/* 옵션 라벨 필 — 필드 안 토큰 태그. max-w + truncate 로 입력 폭 침식 방지
          (전체 문구는 title 툴팁과 입력란 aria-label 이 보존).
          shrink 허용 + min-w-8: 폭이 모자라면 입력란 대신 칩이 "공장/지…" 로 줄어든다
          (input 은 flex-basis 0 이라 음수 여유 공간의 수축이 칩에 몰린다). */}
      <span
        title={label}
        className={cn(
          'min-w-8 max-w-[40%] truncate rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600',
          compact && 'px-1.5 py-0.5 text-[11px]',
        )}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
