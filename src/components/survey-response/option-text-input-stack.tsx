'use client';

import type { CSSProperties, ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { OptionTextInput } from './option-text-input';

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
    <label
      style={style}
      className={cn(
        'flex min-h-10 cursor-text items-center gap-2 rounded-[10px] border border-gray-200 bg-white pr-0.5 pl-1 transition-colors hover:border-gray-300 focus-within:border-blue-400 focus-within:hover:border-blue-400',
        compact && 'min-h-8 gap-1.5',
        className,
      )}
    >
      {/* 옵션 라벨 필 — 필드 안 토큰 태그. max-w + truncate 로 입력 폭 침식 방지
          (전체 문구는 title 툴팁과 입력란 aria-label 이 보존) */}
      <span
        title={label}
        className={cn(
          'max-w-[40%] shrink-0 truncate rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600',
          compact && 'px-1.5 py-0.5 text-[11px]',
        )}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

export interface OptionTextStackEntry {
  /** OptionTextInput 저장 키(option.id) + placeholder 소스 */
  option: { id: string; textInputPlaceholder?: string | undefined };
  /** 라벨 칩 문구 (토큰 치환 완료본) */
  label: string;
}

interface OptionTextInputStackProps {
  questionId: string;
  entries: OptionTextStackEntry[];
  className?: string | undefined;
}

/**
 * allowTextInput 옵션의 상세 기재 입력란 스택.
 * 셀/질문의 옵션 그리드 아래에 OptionTextRow 가 선택 순서대로 쌓인다
 * (radio/checkbox 셀의 CellOptionsContainer footer 슬롯, 일반 radio/checkbox 질문 공용).
 * 입력값 저장은 인라인과 동일한 optionTexts 사이드카(OptionTextInput)라 데이터 영향 없음.
 */
export function OptionTextInputStack({ questionId, entries, className }: OptionTextInputStackProps) {
  if (entries.length === 0) return null;

  return (
    <div className={className ?? 'space-y-1.5'}>
      {entries.map(({ option, label }) => (
        <OptionTextRow key={option.id} label={label}>
          <OptionTextInput
            questionId={questionId}
            option={option}
            ariaLabel={label}
            unstyled
            className={OPTION_TEXT_BARE_INPUT_CLS}
          />
        </OptionTextRow>
      ))}
    </div>
  );
}
